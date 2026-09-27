// Package access defines what each role in a space may do.
//
//	owner  – one per space (its creator): everything, including deleting the space and making admins.
//	admin  – manage members and invitations, rename the space, publish anything, delete any note.
//	editor – write notes, edit any note, delete their own, publish their own notes.
//	guest  – read only.
package access

import "focuz-api/globals"

const (
	Owner  = "owner"
	Admin  = "admin"
	Editor = "editor"
	Guest  = "guest"
)

// Name returns the role name for a role id ("" when the id is not a role, e.g. 0 = not a member).
func Name(roleID int) string {
	switch {
	case roleID == 0:
		return ""
	case roleID == globals.DefaultOwnerRoleID:
		return Owner
	case roleID == globals.DefaultAdminRoleID:
		return Admin
	case roleID == globals.DefaultEditorRoleID:
		return Editor
	case roleID == globals.DefaultGuestRoleID:
		return Guest
	}
	return ""
}

// ID returns the role id for a name (0 when unknown).
func ID(name string) int {
	switch name {
	case Owner:
		return globals.DefaultOwnerRoleID
	case Admin:
		return globals.DefaultAdminRoleID
	case Editor:
		return globals.DefaultEditorRoleID
	case Guest:
		return globals.DefaultGuestRoleID
	}
	return 0
}

// Rank orders roles: owner 4 > admin 3 > editor 2 > guest 1 > not a member 0.
func Rank(roleID int) int {
	switch Name(roleID) {
	case Owner:
		return 4
	case Admin:
		return 3
	case Editor:
		return 2
	case Guest:
		return 1
	}
	return 0
}

func IsMember(roleID int) bool { return Rank(roleID) > 0 }
func CanWrite(roleID int) bool { return Rank(roleID) >= 2 }

// CanEditNote: editors and above may edit any note in the space.
func CanEditNote(roleID int) bool { return Rank(roleID) >= 2 }

// CanDeleteNote: admins delete anything, editors only what they wrote.
func CanDeleteNote(roleID, authorID, userID int) bool {
	return Rank(roleID) >= 3 || (Rank(roleID) == 2 && authorID == userID)
}

// CanManage covers members, invitations, renaming the space and publishing the whole space.
func CanManage(roleID int) bool { return Rank(roleID) >= 3 }

// CanPublishNote: admins publish any note, editors their own.
func CanPublishNote(roleID, authorID, userID int) bool {
	return Rank(roleID) >= 3 || (Rank(roleID) == 2 && authorID == userID)
}

// CanAssign reports whether actor may give target (currently targetRole, 0 for an invitation)
// the role newRole. Nobody can become or stop being the owner; only the owner handles admins.
func CanAssign(actorRole, targetRole, newRole int) bool {
	if !CanManage(actorRole) || Name(newRole) == "" || Name(newRole) == Owner || Name(targetRole) == Owner {
		return false
	}
	if Name(actorRole) == Owner {
		return true
	}
	return Rank(targetRole) < Rank(actorRole) && Rank(newRole) < Rank(actorRole)
}

// CanRemove reports whether actor may remove a member with targetRole (leaving is separate).
func CanRemove(actorRole, targetRole int) bool {
	if !CanManage(actorRole) || Name(targetRole) == Owner || Rank(targetRole) == 0 {
		return false
	}
	return Name(actorRole) == Owner || Rank(targetRole) < Rank(actorRole)
}
