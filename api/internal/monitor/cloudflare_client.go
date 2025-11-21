package monitor

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"time"
)

type CloudflareClient struct {
	APIToken string
	Client   *http.Client
}

func NewCloudflareClient(apiToken string) *CloudflareClient {
	return &CloudflareClient{
		APIToken: apiToken,
		Client:   &http.Client{},
	}
}

func (c *CloudflareClient) doRequest(method, url string, body interface{}, contentType string) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		if v, ok := body.(io.Reader); ok {
			reqBody = v
		} else {
			jsonBytes, err := json.Marshal(body)
			if err != nil {
				return nil, err
			}
			reqBody = bytes.NewBuffer(jsonBytes)
		}
	}

	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.APIToken)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	} else if body != nil && reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("cloudflare api error: %s %s", resp.Status, string(respBytes))
	}

	return respBytes, nil
}

type KVNamespaceResponse struct {
	Success bool `json:"success"`
	Result  struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	} `json:"result"`
	Errors []interface{} `json:"errors"`
}

func (c *CloudflareClient) CreateKVNamespace(accountID, title string) (string, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces", accountID)
	payload := map[string]string{"title": title}

	respBytes, err := c.doRequest("POST", url, payload, "")
	if err != nil {
		return "", err
	}

	var resp KVNamespaceResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return "", err
	}

	if !resp.Success {
		return "", fmt.Errorf("failed to create kv namespace: %v", resp.Errors)
	}

	return resp.Result.ID, nil
}

func (c *CloudflareClient) CreateD1Database(accountID, name string) (string, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/d1/database", accountID)
	payload := map[string]string{"name": name}

	respBytes, err := c.doRequest("POST", url, payload, "")
	if err != nil {
		return "", err
	}

	var resp struct {
		Success bool `json:"success"`
		Result  struct {
			UUID string `json:"uuid"`
		} `json:"result"`
		Errors []interface{} `json:"errors"`
	}
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return "", err
	}

	if !resp.Success {
		return "", fmt.Errorf("failed to create d1 database: %v", resp.Errors)
	}

	return resp.Result.UUID, nil
}

// ListD1Databases lists all D1 databases in the account
func (c *CloudflareClient) ListD1Databases(accountID string) ([]struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
}, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/d1/database", accountID)

	respBytes, err := c.doRequest("GET", url, nil, "")
	if err != nil {
		return nil, err
	}

	var resp struct {
		Success bool `json:"success"`
		Result  []struct {
			UUID string `json:"uuid"`
			Name string `json:"name"`
		} `json:"result"`
		Errors []interface{} `json:"errors"`
	}
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return nil, err
	}

	if !resp.Success {
		return nil, fmt.Errorf("failed to list d1 databases: %v", resp.Errors)
	}

	return resp.Result, nil
}

// GetOrCreateD1Database gets existing database by name or creates a new one
func (c *CloudflareClient) GetOrCreateD1Database(accountID, name string) (string, error) {
	// First, try to list existing databases
	databases, err := c.ListD1Databases(accountID)
	if err != nil {
		return "", err
	}

	// Check if database with this name already exists
	for _, db := range databases {
		if db.Name == name {
			return db.UUID, nil
		}
	}

	// Database doesn't exist, create it
	return c.CreateD1Database(accountID, name)
}

func (c *CloudflareClient) ExecuteD1SQL(accountID, databaseID, sql string, params []interface{}) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query", accountID, databaseID)

	payload := map[string]interface{}{
		"sql":    sql,
		"params": params,
	}
	if params == nil {
		payload["params"] = []interface{}{}
	}

	respBytes, err := c.doRequest("POST", url, payload, "")
	if err != nil {
		return err
	}

	var resp struct {
		Success bool          `json:"success"`
		Errors  []interface{} `json:"errors"`
	}
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return err
	}

	if !resp.Success {
		return fmt.Errorf("failed to execute d1 sql: %v", resp.Errors)
	}

	return nil
}

// QueryD1SQL executes a SELECT query and returns results
func (c *CloudflareClient) QueryD1SQL(accountID, databaseID, sql string, params []interface{}) ([]map[string]interface{}, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query", accountID, databaseID)

	payload := map[string]interface{}{
		"sql":    sql,
		"params": params,
	}
	if params == nil {
		payload["params"] = []interface{}{}
	}

	respBytes, err := c.doRequest("POST", url, payload, "")
	if err != nil {
		return nil, err
	}

	var resp struct {
		Success bool `json:"success"`
		Result  []struct {
			Results []map[string]interface{} `json:"results"`
		} `json:"result"`
		Errors []interface{} `json:"errors"`
	}
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return nil, err
	}

	if !resp.Success {
		return nil, fmt.Errorf("failed to query d1 sql: %v", resp.Errors)
	}

	if len(resp.Result) > 0 {
		return resp.Result[0].Results, nil
	}

	return []map[string]interface{}{}, nil
}

type WorkerBinding struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	NamespaceID string `json:"namespace_id,omitempty"` // For KV
	DatabaseID  string `json:"id,omitempty"`           // For D1 (API uses 'id' for D1 binding)
	Text        string `json:"text,omitempty"`
}

func (c *CloudflareClient) UploadWorker(accountID, workerName, scriptContent string, bindings []WorkerBinding) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s", accountID, workerName)

	// We need to send multipart/form-data
	// Part 1: metadata (bindings, main_module)
	// Part 2: script content (index.ts or index.js)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Metadata
	metadata := map[string]interface{}{
		"main_module":         "index.js",
		"bindings":            bindings,
		"compatibility_date":  "2024-01-01",
		"compatibility_flags": []string{"nodejs_compat"},
	}
	metadataBytes, _ := json.Marshal(metadata)

	part, _ := writer.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": []string{`form-data; name="metadata"`},
		"Content-Type":        []string{"application/json"},
	})
	part.Write(metadataBytes)

	// Script
	// Note: Cloudflare API expects the script file to be named matching main_module if using modules
	part, _ = writer.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": []string{`form-data; name="index.js"; filename="index.js"`},
		"Content-Type":        []string{"application/javascript+module"},
	})
	part.Write([]byte(scriptContent))

	writer.Close()

	_, err := c.doRequest("PUT", url, body, writer.FormDataContentType())
	return err
}

func (c *CloudflareClient) CreateCronTrigger(accountID, workerName, cron string) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s/schedules", accountID, workerName)

	payload := []map[string]string{
		{"cron": cron},
	}

	_, err := c.doRequest("PUT", url, payload, "")
	return err
}

func (c *CloudflareClient) WriteKV(accountID, namespaceID, key, value string) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s/values/%s", accountID, namespaceID, key)

	// PUT body is the value directly
	_, err := c.doRequest("PUT", url, bytes.NewBufferString(value), "text/plain")
	return err
}

// DeleteD1Database deletes a D1 database
func (c *CloudflareClient) DeleteD1Database(accountID, databaseID string) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s", accountID, databaseID)
	_, err := c.doRequest("DELETE", url, nil, "")
	return err
}

// DeleteWorker deletes a Cloudflare Worker
func (c *CloudflareClient) DeleteWorker(accountID, workerName string) error {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s", accountID, workerName)
	_, err := c.doRequest("DELETE", url, nil, "")
	return err
}

type WorkerDetails struct {
	ID         string          `json:"id"`
	CreatedOn  string          `json:"created_on"`
	ModifiedOn string          `json:"modified_on"`
	UsageModel string          `json:"usage_model"`
	Routes     []interface{}   `json:"routes"` // Deprecated but sometimes present
	Bindings   []WorkerBinding `json:"bindings"`
}

func (c *CloudflareClient) GetWorkerDetails(accountID, workerName string) (*WorkerDetails, error) {
	// Use /settings endpoint to get bindings.
	// Note: This endpoint doesn't return created_on/modified_on, but we mainly need bindings for the UI.
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/workers/scripts/%s/settings", accountID, workerName)

	respBytes, err := c.doRequest("GET", url, nil, "")
	if err != nil {
		return nil, err
	}

	var resp struct {
		Success bool          `json:"success"`
		Result  WorkerDetails `json:"result"`
		Errors  []interface{} `json:"errors"`
	}
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return nil, err
	}

	if !resp.Success {
		return nil, fmt.Errorf("failed to get worker details: %v", resp.Errors)
	}

	return &resp.Result, nil
}

type WorkerMetrics struct {
	Requests uint64  `json:"requests"`
	Errors   uint64  `json:"errors"`
	CPUTime  float64 `json:"cpu_time"` // Average or P50 in ms
}

func (c *CloudflareClient) GetWorkerMetrics(accountID, workerName string) (*WorkerMetrics, error) {
	url := "https://api.cloudflare.com/client/v4/graphql"

	// Query for last 24 hours
	query := `
		query GetWorkerMetrics($accountTag: String, $scriptName: String, $datetimeStart: String, $datetimeEnd: String) {
			viewer {
				accounts(filter: {accountTag: $accountTag}) {
					workersInvocationsAdaptive(limit: 1, filter: {
						scriptName: $scriptName,
						datetime_geq: $datetimeStart,
						datetime_leq: $datetimeEnd
					}) {
						sum {
							requests
							errors
						}
						quantiles {
							cpuTimeP50
						}
					}
				}
			}
		}
	`

	now := time.Now()
	start := now.Add(-24 * time.Hour)

	payload := map[string]interface{}{
		"query": query,
		"variables": map[string]interface{}{
			"accountTag":    accountID,
			"scriptName":    workerName,
			"datetimeStart": start.Format(time.RFC3339),
			"datetimeEnd":   now.Format(time.RFC3339),
		},
	}

	respBytes, err := c.doRequest("POST", url, payload, "")
	if err != nil {
		return nil, err
	}

	var resp struct {
		Data struct {
			Viewer struct {
				Accounts []struct {
					WorkersInvocationsAdaptive []struct {
						Sum struct {
							Requests uint64 `json:"requests"`
							Errors   uint64 `json:"errors"`
						} `json:"sum"`
						Quantiles struct {
							CPUTimeP50 float64 `json:"cpuTimeP50"`
						} `json:"quantiles"`
					} `json:"workersInvocationsAdaptive"`
				} `json:"accounts"`
			} `json:"viewer"`
		} `json:"data"`
		Errors []interface{} `json:"errors"`
	}

	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return nil, err
	}

	if len(resp.Errors) > 0 {
		return nil, fmt.Errorf("graphql errors: %v", resp.Errors)
	}

	metrics := &WorkerMetrics{}
	if len(resp.Data.Viewer.Accounts) > 0 && len(resp.Data.Viewer.Accounts[0].WorkersInvocationsAdaptive) > 0 {
		data := resp.Data.Viewer.Accounts[0].WorkersInvocationsAdaptive[0]
		metrics.Requests = data.Sum.Requests
		metrics.Errors = data.Sum.Errors

		// Use P50 for CPU time (usually in microseconds, convert to ms)
		metrics.CPUTime = data.Quantiles.CPUTimeP50 / 1000.0
	}

	return metrics, nil
}
