package filestore

import "testing"

func TestAttachmentID(t *testing.T) {
	const id = "0b6f1d7e-4c2a-4f7e-9a51-2f4c3e1d8a90"
	cases := []struct {
		key  string
		want string
		ok   bool
	}{
		{id, id, true},
		{id + "/thumb.webp", id, true},
		{"0B6F1D7E-4C2A-4F7E-9A51-2F4C3E1D8A90", id, true},
		{"", "", false},
		{"avatars/1.webp", "", false},
		{"0b6f1d7e4c2a4f7e9a512f4c3e1d8a90", "", false}, // not the stored form
		{"urn:uuid:" + id, "", false},
	}
	for _, c := range cases {
		got, ok := AttachmentID(c.key)
		if got != c.want || ok != c.ok {
			t.Errorf("AttachmentID(%q) = %q, %v; want %q, %v", c.key, got, ok, c.want, c.ok)
		}
	}
}

func TestRemoveWithoutStoreIsNoop(t *testing.T) {
	var s *Store
	s.Remove([]string{"0b6f1d7e-4c2a-4f7e-9a51-2f4c3e1d8a90"})
	(&Store{}).Remove([]string{"0b6f1d7e-4c2a-4f7e-9a51-2f4c3e1d8a90"})
}
