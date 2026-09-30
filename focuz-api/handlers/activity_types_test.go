package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
)

func (s *E2ETestSuite) Test42_CreateActivityType_Success() {
	reqBody := map[string]interface{}{
		"name":        "Test Activity",
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
}

func (s *E2ETestSuite) Test43_CreateActivityType_MinValueError() {
	reqBody := map[string]interface{}{
		"name":        "Test Activity",
		"valueType":   "integer",
		"minValue":    15.0, // Greater than maxValue
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
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test44_DeleteActivityType() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "To Delete",
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

		// Delete the activity type
		req2, _ := http.NewRequest("PATCH", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types/"+strconv.Itoa(activityTypeID)+"/delete", nil)
		req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
		resp2, err2 := client.Do(req2)
		s.NoError(err2)
		defer resp2.Body.Close()
		s.Equal(http.StatusOK, resp2.StatusCode)
	} else {
		s.Fail("Activity type creation response does not contain data")
	}
}

func (s *E2ETestSuite) Test45_RestoreActivityType() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "To Restore",
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

		// Delete the activity type
		req2, _ := http.NewRequest("PATCH", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types/"+strconv.Itoa(activityTypeID)+"/delete", nil)
		req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
		resp2, err2 := client.Do(req2)
		s.NoError(err2)
		defer resp2.Body.Close()
		s.Equal(http.StatusOK, resp2.StatusCode)

		// Restore the activity type
		req3, _ := http.NewRequest("PATCH", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types/"+strconv.Itoa(activityTypeID)+"/restore", nil)
		req3.Header.Set("Authorization", "Bearer "+s.ownerToken)
		resp3, err3 := client.Do(req3)
		s.NoError(err3)
		defer resp3.Body.Close()
		s.Equal(http.StatusCreated, resp3.StatusCode)

		// Verify the activity type was restored
		var restoreResponse map[string]interface{}
		json.NewDecoder(resp3.Body).Decode(&restoreResponse)
		s.True(restoreResponse["success"].(bool))

		if restoreResponse["data"] != nil {
			restoreData := restoreResponse["data"].(map[string]interface{})
			s.Equal("To Restore", restoreData["name"])
		} else {
			s.Fail("Restore response does not contain data")
		}
	} else {
		s.Fail("Activity type creation response does not contain data")
	}
}

func (s *E2ETestSuite) Test46_CreateActivityType_DuplicateName() {
	// First create an activity type
	reqBody := map[string]interface{}{
		"name":        "Duplicate Test",
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

	// Try to create another activity type with the same name
	req2, _ := http.NewRequest("POST", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", bytes.NewBuffer(jsonBody))
	req2.Header.Set("Authorization", "Bearer "+s.ownerToken)
	req2.Header.Set("Content-Type", "application/json")
	resp2, err2 := client.Do(req2)
	s.NoError(err2)
	defer resp2.Body.Close()
	s.Equal(http.StatusBadRequest, resp2.StatusCode)
}

func (s *E2ETestSuite) Test47_InvalidValueType() {
	reqBody := map[string]interface{}{
		"name":        "Invalid Type",
		"valueType":   "invalid_type",
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
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test48_InvalidAggregation() {
	reqBody := map[string]interface{}{
		"name":        "Invalid Aggregation",
		"valueType":   "integer",
		"minValue":    1.0,
		"maxValue":    10.0,
		"aggregation": "invalid_agg",
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
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test49_TimeWithNullUnit_Valid() {
	reqBody := map[string]interface{}{
		"name":        "Time Activity",
		"valueType":   "time",
		"minValue":    0.0,
		"maxValue":    nil,
		"aggregation": "sum",
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
}

func (s *E2ETestSuite) Test50_TimeWithUnit_Invalid() {
	reqBody := map[string]interface{}{
		"name":        "Time Activity",
		"valueType":   "time",
		"minValue":    0.0,
		"maxValue":    nil,
		"aggregation": "sum",
		"unit":        "invalid_unit",
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
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test51_BooleanWithInvalidAggregation() {
	reqBody := map[string]interface{}{
		"name":        "Boolean Activity",
		"valueType":   "boolean",
		"minValue":    nil,
		"maxValue":    nil,
		"aggregation": "sum", // Invalid for boolean
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
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test52_TextWithInvalidAggregation() {
	reqBody := map[string]interface{}{
		"name":        "Text Activity",
		"valueType":   "text",
		"minValue":    nil,
		"maxValue":    nil,
		"aggregation": "avg", // Invalid for text
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
	s.Equal(http.StatusBadRequest, resp.StatusCode)
}

func (s *E2ETestSuite) Test53_GetActivityTypesBySpace() {
	req, _ := http.NewRequest("GET", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types", nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusOK, resp.StatusCode)

	var response map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&response)
	s.True(response["success"].(bool))

	// Handle paginated response structure
	data := response["data"].(map[string]interface{})
	activityTypes := data["data"].([]interface{})
	s.True(len(activityTypes) >= 1)
}

func (s *E2ETestSuite) Test54_CannotDeleteDefaultActivityType() {
	// Try to delete a default activity type (should fail)
	req, _ := http.NewRequest("PATCH", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types/1/delete", nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusForbidden, resp.StatusCode)
}

func (s *E2ETestSuite) Test55_CannotRestoreDefaultActivityType() {
	// Try to restore a default activity type (should fail)
	req, _ := http.NewRequest("PATCH", s.baseURL+"/spaces/"+strconv.Itoa(s.createdSpaceID)+"/activity-types/1/restore", nil)
	req.Header.Set("Authorization", "Bearer "+s.ownerToken)
	client := &http.Client{}
	resp, err := client.Do(req)
	s.NoError(err)
	defer resp.Body.Close()
	s.Equal(http.StatusForbidden, resp.StatusCode)
}
