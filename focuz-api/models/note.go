package models

import "time"

type Note struct {
	ID          int            `json:"id"`
	UserID      int            `json:"userId"`
	Text        string         `json:"text"`
	Tags        []string       `json:"tags"`
	CreatedAt   time.Time      `json:"createdAt"`
	ModifiedAt  time.Time      `json:"modifiedAt"`
	Date        time.Time      `json:"date"`
	Parent      *ParentNote    `json:"parent"`
	ReplyCount  int            `json:"replyCount"`
	IsDeleted   bool           `json:"-"`
	SpaceID     int            `json:"spaceId"`
	Activities  []NoteActivity `json:"activities"`
	Attachments []Attachment   `json:"attachments"`
}

type ParentNote struct {
	ID   int    `json:"id"`
	Text string `json:"text"`
}

type NoteActivity struct {
	ID     int     `json:"id"`
	TypeID int     `json:"typeId"`
	Value  string  `json:"value"`
	Unit   *string `json:"unit,omitempty"`
}

type Attachment struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	FileName string `json:"fileName"`
	FileType string `json:"fileType"`
	FileSize int64  `json:"fileSize"`
}

type NoteFilters struct {
	Tags        []string   `json:"tags"`
	NotReply    bool       `json:"notReply"`
	Page        int        `json:"page"`
	PageSize    int        `json:"pageSize"`
	ParentID    *int       `json:"parentId"`
	SortField   string     `json:"sortField"`
	SortOrder   string     `json:"sortOrder"`
	DateFrom    *time.Time `json:"dateFrom"`
	DateTo      *time.Time `json:"dateTo"`
}
