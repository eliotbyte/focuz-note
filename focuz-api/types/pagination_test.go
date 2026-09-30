package types

import "testing"

func TestNewPaginationHelperClampsPageSize(t *testing.T) {
	cases := map[int]int{0: 20, -1: 10, -1000: 10, 5: 10, 10: 10, 30: 20, 50: 50, 1000: 100}
	for in, want := range cases {
		if got := NewPaginationHelper(1, in).PageSize; got != want {
			t.Errorf("pageSize %d: got %d, want %d", in, got, want)
		}
	}
}
