package repository

import (
	"database/sql"
	"focuz-api/models"
)

type RolesRepository struct {
	db *sql.DB
}

func NewRolesRepository(db *sql.DB) *RolesRepository {
	return &RolesRepository{db: db}
}

func (r *RolesRepository) GetRoleByName(name string) (*models.Role, error) {
	var role models.Role
	err := r.db.QueryRow(`
		SELECT id, name FROM role WHERE name = $1
	`, name).Scan(&role.ID, &role.Name)
	if err != nil {
		return nil, err
	}
	return &role, nil
}

func (r *RolesRepository) GetRoleByID(id int) (*models.Role, error) {
	var role models.Role
	err := r.db.QueryRow(`
		SELECT id, name FROM role WHERE id = $1
	`, id).Scan(&role.ID, &role.Name)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &role, nil
}
