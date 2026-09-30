package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
)

func (s *E2ETestSuite) Test90_CreateFilter() {
	reqBody := map[string]interface{}{
		"spaceId":  s.createdSpaceID,
		"parentId": nil,
		"name":     "Important notes",
		"params": map[string]interface{}{
			"tags":     []string{"important"},
			"notReply": true,
		},
	}
	b, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/filters", bytes.NewBuffer(b))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)
}

func (s *E2ETestSuite) Test91_ListFilters() {
	req, _ := http.NewRequest("GET", s.baseURL+"/filters?spaceId="+strconv.Itoa(s.createdSpaceID), nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
}

func (s *E2ETestSuite) Test92_CreateNestedFilter() {
	// create parent
	parent := map[string]interface{}{
		"spaceId": s.createdSpaceID,
		"name":    "Group A",
		"params":  map[string]interface{}{},
	}
	pb, _ := json.Marshal(parent)
	req1, _ := http.NewRequest("POST", s.baseURL+"/filters", bytes.NewBuffer(pb))
	req1.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req1.Header.Set("Content-Type", "application/json")
	resp1, err1 := (&http.Client{}).Do(req1)
	s.NoError(err1)
	defer resp1.Body.Close()
	s.Equal(http.StatusCreated, resp1.StatusCode)
	var body map[string]interface{}
	bb, _ := io.ReadAll(resp1.Body)
	json.Unmarshal(bb, &body)
	parentID := 0
	if body["data"] != nil {
		data := body["data"].(map[string]interface{})
		parentID = int(data["id"].(float64))
	}

	child := map[string]interface{}{
		"spaceId":  s.createdSpaceID,
		"parentId": parentID,
		"name":     "Child of Group A",
		"params": map[string]interface{}{
			"tags": []string{"child"},
		},
	}
	cb, _ := json.Marshal(child)
	req2, _ := http.NewRequest("POST", s.baseURL+"/filters", bytes.NewBuffer(cb))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := (&http.Client{}).Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)
}

func (s *E2ETestSuite) Test93_UpdateDeleteRestoreFilter() {
	// Create filter
	reqBody := map[string]interface{}{
		"spaceId": s.createdSpaceID,
		"name":    "Temp",
		"params":  map[string]interface{}{},
	}
	b, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/filters", bytes.NewBuffer(b))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	var created map[string]interface{}
	bb, _ := io.ReadAll(resp.Body)
	json.Unmarshal(bb, &created)
	fid := int(created["data"].(map[string]interface{})["id"].(float64))

	// Update name and params
	upd := map[string]interface{}{
		"name":   "Temp2",
		"params": map[string]interface{}{"tags": []string{"t1"}},
	}
	ub, _ := json.Marshal(upd)
	reqU, _ := http.NewRequest("PATCH", s.baseURL+"/filters/"+strconv.Itoa(fid), bytes.NewBuffer(ub))
	reqU.Header.Set("Authorization", "Bearer "+s.ownerToken)
	reqU.Header.Set("Content-Type", "application/json")
	respU, errU := (&http.Client{}).Do(reqU)
	s.NoError(errU)
	defer respU.Body.Close()
	s.Equal(http.StatusOK, respU.StatusCode)

	// Delete
	reqD, _ := http.NewRequest("PATCH", s.baseURL+"/filters/"+strconv.Itoa(fid)+"/delete", nil)
	reqD.Header.Set("Authorization", "Bearer "+s.ownerToken)
	respD, errD := (&http.Client{}).Do(reqD)
	s.NoError(errD)
	defer respD.Body.Close()
	s.Equal(http.StatusOK, respD.StatusCode)

	// Restore
	reqR, _ := http.NewRequest("PATCH", s.baseURL+"/filters/"+strconv.Itoa(fid)+"/restore", nil)
	reqR.Header.Set("Authorization", "Bearer "+s.ownerToken)
	respR, errR := (&http.Client{}).Do(reqR)
	s.NoError(errR)
	defer respR.Body.Close()
	s.Equal(http.StatusOK, respR.StatusCode)
}
