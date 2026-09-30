package models

import "time"

type Tag struct {
	ID         int       `json:"id"`
	SpaceID    int       `json:"spaceId"`
	Name       string    `json:"name"`
	CreatedAt  time.Time `json:"createdAt"`
	ModifiedAt time.Time `json:"modifiedAt"`
	IsDeleted  bool      `json:"-"`
}
