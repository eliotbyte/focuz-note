package models

import "time"

type ActivityType struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	ValueType   string    `json:"valueType"`
	MinValue    *float64  `json:"minValue,omitempty"`
	MaxValue    *float64  `json:"maxValue,omitempty"`
	Aggregation string    `json:"aggregation"`
	SpaceID     int       `json:"spaceId,omitempty"`
	IsDefault   bool      `json:"isDefault"`
	IsDeleted   bool      `json:"-"`
	Unit        *string   `json:"unit,omitempty"`
	CategoryID  int       `json:"categoryId,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	ModifiedAt  time.Time `json:"modifiedAt"`
}
