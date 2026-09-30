package repository

import (
	"database/sql"
	"focuz-api/models"
	"time"
)

type TagsRepository struct {
	db *sql.DB
}

func NewTagsRepository(db *sql.DB) *TagsRepository { return &TagsRepository{db: db} }

// GetTagsBySpace returns all tags present in a given space.
func (r *TagsRepository) GetTagsBySpace(spaceID int) ([]models.Tag, error) {
	rows, err := r.db.Query(`
		SELECT t.id, t.name, ts.created_at
		FROM tag t
		JOIN tag_to_space ts ON ts.tag_id = t.id
		WHERE ts.space_id = $1
		ORDER BY t.name
	`, spaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Tag
	for rows.Next() {
		var it models.Tag
		var created time.Time
		if err := rows.Scan(&it.ID, &it.Name, &created); err != nil {
			return nil, err
		}
		it.SpaceID = spaceID
		it.CreatedAt = created
		it.ModifiedAt = created
		out = append(out, it)
	}
	return out, nil
}
