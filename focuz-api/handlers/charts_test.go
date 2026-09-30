package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

func (s *E2ETestSuite) Test94_CreateAndUpdateChartNote() {
	// Helper: create a note in the current space
	createNote := func(text string) int {
		body := map[string]interface{}{
			"text":    text,
			"tags":    []string{"chart"},
			"date":    time.Now().Format(time.RFC3339),
			"spaceId": s.createdSpaceID,
		}
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(b))
		req.Header.Set("Authorization", "Bearer "+s.ownerToken)
		req.Header.Set("Content-Type", "application/json")
		resp, err := (&http.Client{}).Do(req)
		s.NoError(err)
		defer resp.Body.Close()
		s.Equal(http.StatusCreated, resp.StatusCode)
		var respJSON map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&respJSON)
		data := respJSON["data"].(map[string]interface{})
		return int(data["id"].(float64))
	}

	// Helper: get a valid activity type id for the space
	getActivityTypeID := func() int {
		req, _ := http.NewRequest("GET", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", nil)
		req.Header.Set("Authorization", "Bearer "+s.ownerToken)
		resp, err := (&http.Client{}).Do(req)
		s.NoError(err)
		defer resp.Body.Close()
		s.Equal(http.StatusOK, resp.StatusCode)
		var respJSON map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&respJSON)
		data := respJSON["data"].(map[string]interface{})
		items := data["data"].([]interface{})
		s.True(len(items) > 0)
		first := items[0].(map[string]interface{})
		return int(first["id"].(float64))
	}

	noteID1 := createNote("chart-note-1")
	noteID2 := createNote("chart-note-2")
	activityTypeID := getActivityTypeID()

	// Create chart attached to noteID1
	createBody := map[string]interface{}{
		"spaceId":        s.createdSpaceID,
		"kindId":         1,
		"activityTypeId": activityTypeID,
		"periodId":       2,
		"name":           "Chart A",
		"description":    "desc",
		"noteId":         noteID1,
	}
	cb, _ := json.Marshal(createBody)
	reqCreate, _ := http.NewRequest("POST", s.baseURL+"/charts", bytes.NewBuffer(cb))
	reqCreate.Header.Set("Authorization", "Bearer "+s.ownerToken)
	reqCreate.Header.Set("Content-Type", "application/json")
	respCreate, err := (&http.Client{}).Do(reqCreate)
	s.NoError(err)
	defer respCreate.Body.Close()
	s.Equal(http.StatusCreated, respCreate.StatusCode)

	var createResp map[string]interface{}
	json.NewDecoder(respCreate.Body).Decode(&createResp)
	chartData := createResp["data"].(map[string]interface{})
	chartID := int(chartData["id"].(float64))
	s.True(chartID > 0)
	s.Equal(float64(noteID1), chartData["noteId"]) // json numbers are float64

	// Update chart to attach to noteID2
	updateBody := map[string]interface{}{
		"noteId": noteID2,
		"name":   "Chart A Updated",
	}
	ub, _ := json.Marshal(updateBody)
	reqUpdate, _ := http.NewRequest("PATCH", s.baseURL+"/charts/"+strconv.Itoa(chartID), bytes.NewBuffer(ub))
	reqUpdate.Header.Set("Authorization", "Bearer "+s.ownerToken)
	reqUpdate.Header.Set("Content-Type", "application/json")
	respUpdate, err := (&http.Client{}).Do(reqUpdate)
	s.NoError(err)
	defer respUpdate.Body.Close()
	s.Equal(http.StatusOK, respUpdate.StatusCode)

	// Verify via list
	reqList, _ := http.NewRequest("GET", s.baseURL+"/charts?spaceId="+strconv.Itoa(s.createdSpaceID), nil)
	reqList.Header.Set("Authorization", "Bearer "+s.ownerToken)
	respList, err := (&http.Client{}).Do(reqList)
	s.NoError(err)
	defer respList.Body.Close()
	s.Equal(http.StatusOK, respList.StatusCode)
	var listResp map[string]interface{}
	json.NewDecoder(respList.Body).Decode(&listResp)
	paged := listResp["data"].(map[string]interface{})
	items := paged["data"].([]interface{})
	found := false
	for _, it := range items {
		m := it.(map[string]interface{})
		if int(m["id"].(float64)) == chartID {
			found = true
			s.Equal(float64(noteID2), m["noteId"])
			s.Equal("Chart A Updated", m["name"].(string))
			break
		}
	}
	s.True(found)
}

func (s *E2ETestSuite) Test95_CreateChart_InvalidNoteSpaceMismatch() {
	// Create a second space and a note in it
	reqSpace, _ := http.NewRequest("POST", s.baseURL+"/spaces", bytes.NewBuffer([]byte(`{"name":"Other Space"}`)))
	reqSpace.Header.Set("Authorization", "Bearer "+s.ownerToken)
	reqSpace.Header.Set("Content-Type", "application/json")
	respSpace, err := (&http.Client{}).Do(reqSpace)
	s.NoError(err)
	defer respSpace.Body.Close()
	s.Equal(http.StatusCreated, respSpace.StatusCode)
	var spaceResp map[string]interface{}
	json.NewDecoder(respSpace.Body).Decode(&spaceResp)
	spaceData := spaceResp["data"].(map[string]interface{})
	otherSpaceID := int(spaceData["id"].(float64))

	// Create note in other space
	noteBody := map[string]interface{}{
		"text":    "other-space-note",
		"tags":    []string{"chart"},
		"date":    time.Now().Format(time.RFC3339),
		"spaceId": otherSpaceID,
	}
	nb, _ := json.Marshal(noteBody)
	reqNote, _ := http.NewRequest("POST", s.baseURL+"/notes", bytes.NewBuffer(nb))
	reqNote.Header.Set("Authorization", "Bearer "+s.ownerToken)
	reqNote.Header.Set("Content-Type", "application/json")
	respNote, err := (&http.Client{}).Do(reqNote)
	s.NoError(err)
	defer respNote.Body.Close()
	s.Equal(http.StatusCreated, respNote.StatusCode)
	var noteResp map[string]interface{}
	json.NewDecoder(respNote.Body).Decode(&noteResp)
	noteData := noteResp["data"].(map[string]interface{})
	otherNoteID := int(noteData["id"].(float64))

	// Get some activity type id
	reqTypes, _ := http.NewRequest("GET", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", nil)
	reqTypes.Header.Set("Authorization", "Bearer "+s.ownerToken)
	respTypes, err := (&http.Client{}).Do(reqTypes)
	s.NoError(err)
	defer respTypes.Body.Close()
	s.Equal(http.StatusOK, respTypes.StatusCode)
	var typesResp map[string]interface{}
	json.NewDecoder(respTypes.Body).Decode(&typesResp)
	items := typesResp["data"].(map[string]interface{})["data"].([]interface{})
	s.True(len(items) > 0)
	activityTypeID := int(items[0].(map[string]interface{})["id"].(float64))

	// Try to create chart in original space but with note from other space -> 400
	body := map[string]interface{}{
		"spaceId":        s.createdSpaceID,
		"kindId":         1,
		"activityTypeId": activityTypeID,
		"periodId":       2,
		"name":           "Bad Chart",
		"noteId":         otherNoteID,
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", s.baseURL+"/charts", bytes.NewBuffer(b))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test96_UpdateChart_InvalidNoteZero() {
	// Create a chart without note
	// Get activity type id
	reqTypes, _ := http.NewRequest("GET", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", nil)
	reqTypes.Header.Set("Authorization", "Bearer "+s.ownerToken)
	respTypes, err := (&http.Client{}).Do(reqTypes)
	s.NoError(err)
	defer respTypes.Body.Close()
	s.Equal(http.StatusOK, respTypes.StatusCode)
	var typesResp map[string]interface{}
	json.NewDecoder(respTypes.Body).Decode(&typesResp)
	items := typesResp["data"].(map[string]interface{})["data"].([]interface{})
	activityTypeID := int(items[0].(map[string]interface{})["id"].(float64))

	createBody := map[string]interface{}{
		"spaceId":        s.createdSpaceID,
		"kindId":         2,
		"activityTypeId": activityTypeID,
		"periodId":       3,
		"name":           "Chart Zero Note",
	}
	cb, _ := json.Marshal(createBody)
	reqCreate, _ := http.NewRequest("POST", s.baseURL+"/charts", bytes.NewBuffer(cb))
	reqCreate.Header.Set("Authorization", "Bearer "+s.ownerToken)
	reqCreate.Header.Set("Content-Type", "application/json")
	respCreate, err := (&http.Client{}).Do(reqCreate)
	s.NoError(err)
	defer respCreate.Body.Close()
	s.Equal(http.StatusCreated, respCreate.StatusCode)
	var createResp map[string]interface{}
	json.NewDecoder(respCreate.Body).Decode(&createResp)
	chartID := int(createResp["data"].(map[string]interface{})["id"].(float64))

	// Try to update with noteId = 0 -> 400
	updateBody := map[string]interface{}{
		"noteId": 0,
	}
	ub, _ := json.Marshal(updateBody)
	reqUpdate, _ := http.NewRequest("PATCH", s.baseURL+"/charts/"+strconv.Itoa(chartID), bytes.NewBuffer(ub))
	reqUpdate.Header.Set("Authorization", "Bearer "+s.ownerToken)
	reqUpdate.Header.Set("Content-Type", "application/json")
	respUpdate, err := (&http.Client{}).Do(reqUpdate)
	s.NoError(err)
	defer respUpdate.Body.Close()
	s.Equal(http.StatusBadRequest, respUpdate.StatusCode)
}

func (s *E2ETestSuite) Test97_ListCharts_IncludesNoteId() {
	// Ensure listing works and includes noteId field on at least one chart
	req, _ := http.NewRequest("GET", s.baseURL+"/charts?spaceId="+strconv.Itoa(s.createdSpaceID)+"&pageSize=10", nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp, err := (&http.Client{}).Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)
	var listResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&listResp)
	paged := listResp["data"].(map[string]interface{})
	items := paged["data"].([]interface{})
	foundWithNote := false
	for _, it := range items {
		m := it.(map[string]interface{})
		if _, has := m["noteId"]; has {
			foundWithNote = true
			break
		}
	}
	s.True(foundWithNote)
}
