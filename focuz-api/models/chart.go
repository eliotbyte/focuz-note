package models

import "time"

type Chart struct {
	ID             int       `json:"id"`
	UserID         int       `json:"userId"`
	SpaceID        int       `json:"spaceId"`
	KindID         int       `json:"kindId"`
	ActivityTypeID int       `json:"activityTypeId"`
	PeriodID       int       `json:"periodId"`
	Name           string    `json:"name"`
	Description    *string   `json:"description,omitempty"`
	NoteID         *int      `json:"noteId,omitempty"`
	IsDeleted      bool      `json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
	ModifiedAt     time.Time `json:"modifiedAt"`
}

type ChartDataPoint struct {
	Date  time.Time `json:"date"`
	Value float64   `json:"value"`
}

type ChartFilters struct {
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}
