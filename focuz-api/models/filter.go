package models

import (
	"encoding/json"
	"time"
)

// Filter represents a saved set of note filters within a space.
// Nesting is represented by parentId only (no inheritance of params).
// Params is stored as raw JSON to allow the frontend to control the schema
// (validated only as syntactically valid JSON by the handler).
// Examples of params align with NoteFilters fields.
// { "tags": ["a", "!b"], "notReply": true, "parentId": null, ... }
//
// We intentionally do not embed NoteFilters here to keep storage flexible.

type Filter struct {
	ID         int             `json:"id"`
	UserID     int             `json:"userId"`
	SpaceID    int             `json:"spaceId"`
	ParentID   *int            `json:"parentId"`
	Name       string          `json:"name"`
	Params     json.RawMessage `json:"params"`
	IsDeleted  bool            `json:"-"`
	CreatedAt  time.Time       `json:"createdAt"`
	ModifiedAt time.Time       `json:"modifiedAt"`
}

// FilterListFilters supports pagination for filters listing.
// We keep it minimal on purpose.
type FilterListFilters struct {
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}
