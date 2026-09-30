package tests

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/lib/pq"
	"github.com/stretchr/testify/suite"
	"golang.org/x/crypto/bcrypt"
)

type IntegrationTestSuite struct {
	suite.Suite
	db *sql.DB
}

func (suite *IntegrationTestSuite) SetupSuite() {
	dsn := os.Getenv("DATABASE_URL")
	db, err := sql.Open("postgres", dsn)
	suite.Require().NoError(err)
	err = db.Ping()
	suite.Require().NoError(err)
	suite.db = db
	suite.prepareDatabase()
}

func (suite *IntegrationTestSuite) TearDownSuite() {
	suite.db.Close()
}

func (suite *IntegrationTestSuite) prepareDatabase() {
	_, err := suite.db.Exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
	suite.Require().NoError(err)

	_, err = suite.db.Exec("CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL);")
	suite.Require().NoError(err)
}

func (suite *IntegrationTestSuite) TestCreateUser() {
	username := "testuser"
	password := "testpass"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	suite.Require().NoError(err)

	var userID int
	err = suite.db.QueryRow(`INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id`, username, string(hash)).Scan(&userID)
	suite.NoError(err)
	suite.True(userID > 0)

	var count int
	err = suite.db.QueryRow(`SELECT COUNT(*) FROM users WHERE username = $1`, username).Scan(&count)
	suite.NoError(err)
	suite.Equal(1, count)
}

func (suite *IntegrationTestSuite) TestCreateUserConflict() {
	username := "testuser"
	password := "anotherpass"
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	_, err := suite.db.Exec(`INSERT INTO users (username, password_hash) VALUES ($1, $2)`, username, string(hash))
	suite.Error(err)
}

func TestIntegrationTestSuite(t *testing.T) {
	suite.Run(t, new(IntegrationTestSuite))
}
