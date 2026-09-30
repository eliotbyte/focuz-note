package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
)

func (s *E2ETestSuite) Test56_CreateActivityValid() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Test Activity Valid",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "avg",
		"unit":        nil,
		"categoryId":  1,
		"spaceId":     s.createdSpaceID,
		"isDefault":   false,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	// Get the created activity type ID
	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))

	// Check if data exists before accessing it
	if response["data"] != nil {
		data := response["data"].(map[string]interface{})
		activityTypeID := int(data["id"].(float64))

		// Create an activity
		activityBody := map[string]interface{}{
			"typeId": activityTypeID,
			"value":  "5",
		}
		activityJson, _ := json.Marshal(activityBody)
		req2, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
		req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
		req2.Header.Set("Content-Type", "application/json")
		resp2, err2 := client.Do(req2)
		s.NoError(err2)
		defer resp2.Body.Close()
		s.Equal(http.StatusCreated, resp2.StatusCode)
	} else {
		s.Fail("Activity type creation response does not contain data")
	}
}

func (s *E2ETestSuite) Test57_CreateActivityOutOfRange() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Test Activity Out of Range",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "avg",
		"unit":        nil,
		"categoryId":  1,
		"spaceId":     s.createdSpaceID,
		"isDefault":   false,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	// Get the created activity type ID
	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))
	data := response["data"].(map[string]interface{})
	activityTypeID := int(data["id"].(float64))

	// Create an activity with value out of range
	activityBody := map[string]interface{}{
		"typeId": activityTypeID,
		"value":  "15", // Out of range (1-10)
	}
	activityJson, _ := json.Marshal(activityBody)
	req2, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusBadRequest, resp2.StatusCode)
}

func (s *E2ETestSuite) Test58_CreateActivityInvalidType() {
	// Create an activity with invalid type
	activityBody := map[string]interface{}{
		"typeId": 99999, // Non-existent type
		"value":  "5",
	}
	activityJson, _ := json.Marshal(activityBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test59_DeleteRestoreActivity() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Test Activity Delete Restore",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "avg",
		"unit":        nil,
		"categoryId":  1,
		"spaceId":     s.createdSpaceID,
		"isDefault":   false,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	// Get the created activity type ID
	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))
	data := response["data"].(map[string]interface{})
	activityTypeID := int(data["id"].(float64))

	// Create an activity
	activityBody := map[string]interface{}{
		"typeId": activityTypeID,
		"value":  "5",
	}
	activityJson, _ := json.Marshal(activityBody)
	req2, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)

	// Get the created activity ID
	var activityResponse map[string]interface{}
	json.NewDecoder(resp2.Body).Decode(&activityResponse)
	s.True(activityResponse["success"].(bool))
	activityData := activityResponse["data"].(map[string]interface{})
	activityID := int(activityData["id"].(float64))

	// Delete the activity
	req3, _ := http.NewRequest("PATCH", s.baseURL+"/activities/"+strconv.Itoa(activityID)+"/delete", nil)
	req3.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp3, err3 := client.Do(req3)
	s.NoError(err3)
	defer resp3.Body.Close()
	s.Equal(http.StatusOK, resp3.StatusCode)

	// Restore the activity
	req4, _ := http.NewRequest("PATCH", s.baseURL+"/activities/"+strconv.Itoa(activityID)+"/restore", nil)
	req4.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp4, err4 := client.Do(req4)
	s.NoError(err4)
	defer resp4.Body.Close()
	s.Equal(http.StatusOK, resp4.StatusCode)
}

func (s *E2ETestSuite) Test60_UpdateActivity() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Test Activity Update",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "avg",
		"unit":        nil,
		"categoryId":  1,
		"spaceId":     s.createdSpaceID,
		"isDefault":   false,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	// Get the created activity type ID
	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))
	data := response["data"].(map[string]interface{})
	activityTypeID := int(data["id"].(float64))

	// Create an activity
	activityBody := map[string]interface{}{
		"typeId": activityTypeID,
		"value":  "5",
	}
	activityJson, _ := json.Marshal(activityBody)
	req2, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)

	// Get the created activity ID
	var activityResponse map[string]interface{}
	json.NewDecoder(resp2.Body).Decode(&activityResponse)
	s.True(activityResponse["success"].(bool))
	activityData := activityResponse["data"].(map[string]interface{})
	activityID := int(activityData["id"].(float64))

	// Update the activity
	updateBody := map[string]interface{}{
		"value": "7",
	}
	updateJson, _ := json.Marshal(updateBody)
	req3, _ := http.NewRequest("PATCH", s.baseURL+"/activities/"+strconv.Itoa(activityID), bytes.NewBuffer(updateJson))
	req3.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req3.Header.Set("Content-Type", "application/json")
	resp3, err3 := client.Do(req3)
	s.NoError(err3)
	defer resp3.Body.Close()
	s.Equal(http.StatusOK, resp3.StatusCode)
}

func (s *E2ETestSuite) Test61_CreateActivityInaccessibleNote() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Test Activity Inaccessible Note",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "avg",
		"unit":        nil,
		"categoryId":  1,
		"spaceId":     s.createdSpaceID,
		"isDefault":   false,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	// Get the created activity type ID
	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))
	data := response["data"].(map[string]interface{})
	activityTypeID := int(data["id"].(float64))

	// Create an activity with inaccessible note
	activityBody := map[string]interface{}{
		"typeId":  activityTypeID,
		"value":   "5",
		"note_id": 99999, // Non-existent note
	}
	activityJson, _ := json.Marshal(activityBody)
	req2, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusBadRequest, resp2.StatusCode)
}

func (s *E2ETestSuite) Test62_GetActivitiesAnalysis() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Test Activity Analysis",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "avg",
		"unit":        nil,
		"categoryId":  1,
		"spaceId":     s.createdSpaceID,
		"isDefault":   false,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	// Get the created activity type ID
	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))
	data := response["data"].(map[string]interface{})
	activityTypeID := int(data["id"].(float64))

	// Create some activities first
	for i := 1; i <= 3; i++ {
		activityBody := map[string]interface{}{
			"typeId": activityTypeID,
			"value":  strconv.Itoa(i + 5), // Values 6, 7, 8
		}
		activityJson, _ := json.Marshal(activityBody)
		req2, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
		req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
		req2.Header.Set("Content-Type", "application/json")
		resp2, err2 := client.Do(req2)
		s.NoError(err2)
		defer resp2.Body.Close()
		s.Equal(http.StatusCreated, resp2.StatusCode)
	}

	// Get activities analysis
	req3, _ := http.NewRequest("GET", s.baseURL+"/activities?spaceId="+strconv.Itoa(s.createdSpaceID)+"&typeId="+strconv.Itoa(activityTypeID)+"&periodId=1", nil)
	req3.Header.Set("Authorization", "Bearer "+s.ownerToken)
	resp3, err3 := client.Do(req3)
	s.NoError(err3)
	defer resp3.Body.Close()
	s.Equal(http.StatusOK, resp3.StatusCode)

	var analysisResponse map[string]interface{}
	json.NewDecoder(resp3.Body).Decode(&analysisResponse)
	s.True(analysisResponse["success"].(bool))
	s.NotNil(analysisResponse["data"], "Activities analysis response does not contain data")
}

func (s *E2ETestSuite) Test63_CannotCreateDuplicateActivityOnSameNote() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Test Activity Duplicate",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "avg",
		"unit":        nil,
		"categoryId":  1,
		"spaceId":     s.createdSpaceID,
		"isDefault":   false,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	// Get the created activity type ID
	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))
	data := response["data"].(map[string]interface{})
	activityTypeID := int(data["id"].(float64))

	// Create an activity with a note
	activityBody := map[string]interface{}{
		"typeId":  activityTypeID,
		"value":   "5",
		"note_id": s.createdNoteID,
	}
	activityJson, _ := json.Marshal(activityBody)
	req2, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)

	// Try to create another activity of the same type on the same note
	req3, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
	req3.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req3.Header.Set("Content-Type", "application/json")
	resp3, err3 := client.Do(req3)
	s.NoError(err3)
	defer resp3.Body.Close()
	s.Equal(http.StatusBadRequest, resp3.StatusCode)
}

func (s *E2ETestSuite) Test64_CanCreateActivityWhenExistingIsDeleted() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Test Activity Deleted",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "avg",
		"unit":        nil,
		"categoryId":  1,
		"spaceId":     s.createdSpaceID,
		"isDefault":   false,
	}
	jsonBody, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusCreated, resp.StatusCode)

	// Get the created activity type ID
	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))
	data := response["data"].(map[string]interface{})
	activityTypeID := int(data["id"].(float64))

	// Create an activity with a note
	activityBody := map[string]interface{}{
		"typeId":  activityTypeID,
		"value":   "5",
		"note_id": s.createdNoteID,
	}
	activityJson, _ := json.Marshal(activityBody)
	req2, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusCreated, resp2.StatusCode)

	// Get the created activity ID
	var activityResponse map[string]interface{}
	json.NewDecoder(resp2.Body).Decode(&activityResponse)
	s.True(activityResponse["success"].(bool))

	// Check if data exists before accessing it
	if activityResponse["data"] != nil {
		activityData := activityResponse["data"].(map[string]interface{})
		activityID := int(activityData["id"].(float64))

		// Delete the activity
		req3, _ := http.NewRequest("PATCH", s.baseURL+"/activities/"+strconv.Itoa(activityID)+"/delete", nil)
		req3.Header.Set("Authorization", "Bearer "+s.ownerToken)
		resp3, err3 := client.Do(req3)
		s.NoError(err3)
		defer resp3.Body.Close()
		s.Equal(http.StatusOK, resp3.StatusCode)

		// Try to create another activity of the same type on the same note (should succeed)
		req4, _ := http.NewRequest("POST", s.baseURL+"/activities", bytes.NewBuffer(activityJson))
		req4.Header.Set("Authorization", "Bearer "+s.ownerToken)
		req4.Header.Set("Content-Type", "application/json")
		resp4, err4 := client.Do(req4)
		s.NoError(err4)
		defer resp4.Body.Close()
		s.Equal(http.StatusCreated, resp4.StatusCode)

		// Check if data exists before accessing it
		var newActivityResponse map[string]interface{}
		json.NewDecoder(resp4.Body).Decode(&newActivityResponse)
		s.True(newActivityResponse["success"].(bool))
		s.NotNil(newActivityResponse["data"], "Activity creation response does not contain data")
	} else {
		s.Fail("Activity creation response does not contain data")
	}
}
