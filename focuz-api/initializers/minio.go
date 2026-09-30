package initializers

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"gopkg.in/yaml.v3"
)

type MinioConfig struct {
	Endpoint         string
	AccessKey        string
	SecretKey        string
	Bucket           string
	UseSSL           bool
	MaxSize          int64
	FileTypes        []string
	Expiry           time.Duration
	ExternalEndpoint string
	ExternalUseSSL   bool
}

var MinioClient *minio.Client
var ExternalMinioClient *minio.Client
var Conf MinioConfig

// uploadsConfigYAML defines optional YAML configuration for upload settings.
// If present, it overrides environment variables for upload-related fields.
type uploadsConfigYAML struct {
	MaxFileSize        int64    `yaml:"max_file_size"`
	AllowedFileTypes   []string `yaml:"allowed_file_types"`
	PresignedURLExpiry int      `yaml:"presigned_url_expiry"` // seconds
}

// loadUploadsConfig tries to load YAML config from disk. If not found, returns nil with error.
func loadUploadsConfig() (*uploadsConfigYAML, error) {
	path := os.Getenv("UPLOADS_CONFIG_FILE")
	if strings.TrimSpace(path) == "" {
		path = "config/uploads.yaml"
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg uploadsConfigYAML
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func InitMinio() error {
	Conf = MinioConfig{
		Endpoint:         os.Getenv("MINIO_ENDPOINT"),
		AccessKey:        os.Getenv("MINIO_ACCESS_KEY"),
		SecretKey:        os.Getenv("MINIO_SECRET_KEY"),
		Bucket:           os.Getenv("MINIO_BUCKET"),
		UseSSL:           parseBool(os.Getenv("MINIO_USE_SSL")),
		MaxSize:          parseInt64(os.Getenv("MAX_FILE_SIZE"), 10485760),
		FileTypes:        parseFileTypes(os.Getenv("ALLOWED_FILE_TYPES")),
		Expiry:           parseExpiry(os.Getenv("PRESIGNED_URL_EXPIRY")),
		ExternalEndpoint: os.Getenv("MINIO_EXTERNAL_ENDPOINT"),
		// ExternalUseSSL controls the scheme for presigned URLs when using an external MinIO endpoint.
		// If MINIO_EXTERNAL_USE_SSL is unset, we try to infer it from MINIO_EXTERNAL_ENDPOINT scheme,
		// otherwise we fallback to MINIO_USE_SSL.
		ExternalUseSSL: func() bool {
			raw := strings.TrimSpace(os.Getenv("MINIO_EXTERNAL_ENDPOINT"))
			if v := strings.TrimSpace(os.Getenv("MINIO_EXTERNAL_USE_SSL")); v != "" {
				return parseBool(v)
			}
			if strings.HasPrefix(raw, "https://") {
				return true
			}
			if strings.HasPrefix(raw, "http://") {
				return false
			}
			return parseBool(os.Getenv("MINIO_USE_SSL"))
		}(),
	}

	// If YAML config exists, override upload-related settings
	if yamlCfg, err := loadUploadsConfig(); err == nil && yamlCfg != nil {
		if yamlCfg.MaxFileSize > 0 {
			Conf.MaxSize = yamlCfg.MaxFileSize
		}
		if len(yamlCfg.AllowedFileTypes) > 0 {
			Conf.FileTypes = yamlCfg.AllowedFileTypes
		}
		if yamlCfg.PresignedURLExpiry > 0 {
			Conf.Expiry = time.Duration(yamlCfg.PresignedURLExpiry) * time.Second
		}
	}

	client, err := minio.New(Conf.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(Conf.AccessKey, Conf.SecretKey, ""),
		Secure: Conf.UseSSL,
	})
	if err != nil {
		return err
	}
	MinioClient = client
	exists, errBucket := client.BucketExists(context.Background(), Conf.Bucket)
	if errBucket != nil {
		return errBucket
	}
	if !exists {
		errCreate := client.MakeBucket(context.Background(), Conf.Bucket, minio.MakeBucketOptions{})
		if errCreate != nil {
			return errCreate
		}
	}

	// Initialize external client once and reuse
	extEndpoint := Conf.ExternalEndpoint
	if strings.HasPrefix(extEndpoint, "http://") {
		extEndpoint = strings.TrimPrefix(extEndpoint, "http://")
	} else if strings.HasPrefix(extEndpoint, "https://") {
		extEndpoint = strings.TrimPrefix(extEndpoint, "https://")
	}
	if extEndpoint == "" || extEndpoint == Conf.Endpoint {
		ExternalMinioClient = MinioClient
	} else {
		external, err := minio.New(extEndpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(Conf.AccessKey, Conf.SecretKey, ""),
			Secure: Conf.ExternalUseSSL,
			Region: "us-east-1",
		})
		if err != nil {
			return err
		}
		ExternalMinioClient = external
	}

	log.Println("Minio bucket ready:", Conf.Bucket)
	return nil
}

func parseBool(val string) bool {
	return strings.ToLower(val) == "true"
}

func parseInt64(val string, def int64) int64 {
	if val == "" {
		return def
	}
	v, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return def
	}
	return v
}

func parseFileTypes(val string) []string {
	if val == "" {
		return []string{"image/jpeg", "image/png", "application/pdf"}
	}
	return strings.Split(val, ",")
}

func parseExpiry(val string) time.Duration {
	if val == "" {
		return time.Hour
	}
	v, err := strconv.Atoi(val)
	if err != nil {
		return time.Hour
	}
	return time.Duration(v) * time.Second
}

func baseMIME(mime string) string {
	if mime == "" {
		return ""
	}
	parts := strings.Split(mime, ";")
	return strings.TrimSpace(parts[0])
}

func CheckFileAllowed(size int64, mime string) error {
	if size > Conf.MaxSize {
		return fmt.Errorf("file size exceeds the limit")
	}
	incoming := baseMIME(mime)
	allowed := false
	for _, t := range Conf.FileTypes {
		if baseMIME(t) == incoming {
			allowed = true
			break
		}
	}
	if !allowed {
		return fmt.Errorf("file type is not allowed")
	}
	return nil
}

func GenerateAttachmentURL(id, fileName string) (string, error) {
	reqParams := make(url.Values)
	reqParams.Set("response-content-disposition", fmt.Sprintf("inline; filename=\"%s\"", sanitizeFilename(fileName)))
	expiry := Conf.Expiry

	client := ExternalMinioClient
	if client == nil {
		client = MinioClient
	}
	presignedURL, err := client.PresignedGetObject(context.Background(), Conf.Bucket, id, expiry, reqParams)
	if err != nil {
		return "", fmt.Errorf("failed to create presigned url: %v", err)
	}
	return presignedURL.String(), nil
}

func sanitizeFilename(name string) string {
	// Remove double quotes, path separators, and control characters; collapse spaces
	cleaned := strings.ReplaceAll(name, "\"", "")
	cleaned = strings.ReplaceAll(cleaned, "\\", "")
	cleaned = strings.ReplaceAll(cleaned, "/", "")
	cleaned = strings.ReplaceAll(cleaned, "..", "")
	// Remove control characters
	b := make([]rune, 0, len(cleaned))
	for _, r := range cleaned {
		if r < 32 || r == 127 {
			continue
		}
		b = append(b, r)
	}
	s := strings.TrimSpace(string(b))
	// Replace multiple spaces with single
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		s = "file"
	}
	return s
}
