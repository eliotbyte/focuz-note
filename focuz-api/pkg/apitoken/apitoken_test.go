package apitoken

import (
	"strings"
	"testing"
)

func TestGenerateIsUniqueAndPrefixed(t *testing.T) {
	a, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := Generate()
	if !strings.HasPrefix(a, Prefix) || len(a) < 40 {
		t.Fatalf("token %q has the wrong shape", a)
	}
	if a == b {
		t.Fatal("two tokens are equal")
	}
	if !IsAPIToken(a) || IsAPIToken("eyJhbGciOi") {
		t.Fatal("IsAPIToken does not tell API tokens from login tokens")
	}
}

func TestHashIsStableAndHidesToken(t *testing.T) {
	raw := "fct_example"
	if Hash(raw) != Hash(raw) || Hash(raw) == raw || len(Hash(raw)) != 64 {
		t.Fatal("hash must be stable, 64 hex chars and differ from the token")
	}
}
