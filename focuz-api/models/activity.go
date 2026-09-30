package models

import "time"

type Activity struct {
	ID         int       `json:"id"`
	UserID     int       `json:"userId"`
	TypeID     int       `json:"typeId"`
	Value      any       `json:"value"`
	NoteID     *int      `json:"noteId,omitempty"`
	IsDeleted  bool      `json:"-"`
	CreatedAt  time.Time `json:"createdAt"`
	ModifiedAt time.Time `json:"modifiedAt"`
}
