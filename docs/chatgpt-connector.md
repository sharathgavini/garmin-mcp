# ChatGPT Connector Setup

1. Deploy the Cloud Run service.
2. Copy the Cloud Run HTTPS service URL.
3. Configure the ChatGPT connector MCP endpoint as:

```text
https://YOUR-CLOUD-RUN-URL/mcp
```

4. Configure authentication with:

```text
Authorization: Bearer YOUR_MCP_BEARER_TOKEN
```

5. Test with the `health_check` tool.

The MCP server never logs into Garmin during ChatGPT requests. It only reads prepared JSON from Google Cloud Storage.
