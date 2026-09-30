package jwtsecret

import "testing"

func TestResolveRejectsWeakSecrets(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	for _, s := range []string{"short", "dev-secret-change-me-please-0123456789abcdef", testSecret} {
		t.Setenv("JWT_SECRET", s)
		if _, _, err := Resolve(nil); err == nil {
			t.Errorf("%q accepted", s)
		}
	}
	t.Setenv("JWT_SECRET", "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a6978")
	if got, generated, err := Resolve(nil); err != nil || generated || got == "" {
		t.Errorf("random secret: %q %v %v", got, generated, err)
	}
	t.Setenv("APP_ENV", "test")
	t.Setenv("JWT_SECRET", testSecret)
	if _, _, err := Resolve(nil); err != nil {
		t.Errorf("test secret in test env: %v", err)
	}
}
