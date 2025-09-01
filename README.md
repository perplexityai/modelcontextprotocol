# Perplexity Ask MCP Server

An MCP server implementation that integrates the Sonar API to provide Claude with unparalleled real-time, web-wide research capabilities, now enhanced with advanced date filtering options.

Please refer to the official [DeepWiki page](https://deepwiki.com/ppl-ai/modelcontextprotocol) for assistance with implementation. 

# High-level System Architecture

*Credits: DeepWiki powered by Devin*

![System Architecture](perplexity-ask/assets/system_architecture.png)

![Demo](perplexity-ask/assets/demo_screenshot.png)

## Tools

### **perplexity_ask**
- Engage in a conversation with the Sonar API for live web searches.
- **Inputs:**
  - `messages` (array): An array of conversation messages.
    - Each message must include:
      - `role` (string): The role of the message (e.g., `system`, `user`, `assistant`).
      - `content` (string): The content of the message.
  - **Date Filtering Options** (all optional):
    - `search_after_date_filter` (string): Filter to content published after this date (format: M/D/YYYY)
    - `search_before_date_filter` (string): Filter to content published before this date (format: M/D/YYYY)
    - `last_updated_after_filter` (string): Filter to content updated after this date (format: M/D/YYYY)
    - `last_updated_before_filter` (string): Filter to content updated before this date (format: M/D/YYYY)
    - `search_recency_filter` (string): Filter by predefined periods ("day", "week", "month", "year")

### **perplexity_research**
- Perform deep research queries using the Perplexity API with comprehensive analysis.
- **Inputs:** Same as `perplexity_ask` including all date filtering options.

### **perplexity_reason**
- Execute advanced reasoning tasks with enhanced analytical capabilities.
- **Inputs:** Same as `perplexity_ask` including all date filtering options.

## Date Filtering Features

### Publication Date Filters
Filter results based on when content was originally created or published:
- `search_after_date_filter`: Include only content published after the specified date
- `search_before_date_filter`: Include only content published before the specified date

### Last Updated Date Filters
Filter results based on when content was last modified:
- `last_updated_after_filter`: Include only content updated after the specified date
- `last_updated_before_filter`: Include only content updated before the specified date

### Recency Filter
Quick filtering by predefined time periods relative to the current date:
- `search_recency_filter`: Use "day", "week", "month", or "year" for convenience

### Filter Usage Examples

1. **Find recent AI developments from the past week:**
```json
{
  "messages": [{"role": "user", "content": "What are the latest AI developments?"}],
  "search_recency_filter": "week"
}
```

2. **Research articles published in March 2025:**
```json
{
  "messages": [{"role": "user", "content": "Machine learning research trends"}],
  "search_after_date_filter": "3/1/2025",
  "search_before_date_filter": "3/31/2025"
}
```

3. **Find recently updated documentation:**
```json
{
  "messages": [{"role": "user", "content": "React development best practices"}],
  "last_updated_after_filter": "1/1/2025"
}
```

4. **Combine publication and update filters:**
```json
{
  "messages": [{"role": "user", "content": "Python tutorials"}],
  "search_after_date_filter": "1/1/2024",
  "search_before_date_filter": "12/31/2024",
  "last_updated_after_filter": "2/1/2025"
}
```

### Important Notes
- Date format must be exactly M/D/YYYY (e.g., "3/1/2025" or "03/01/2025")
- `search_recency_filter` cannot be combined with other date filters
- All date filters are optional and can be used independently or together (except recency filter)

## Configuration

### Step 1: 

Clone this repository:

```bash
git clone git@github.com:ppl-ai/modelcontextprotocol.git
```

Navigate to the `perplexity-ask` directory and install the necessary dependencies:

```bash
cd modelcontextprotocol/perplexity-ask && npm install
```

### Step 2: Get a Sonar API Key

1. Sign up for a [Sonar API account](https://docs.perplexity.ai/guides/getting-started).
2. Follow the account setup instructions and generate your API key from the developer dashboard.
3. Set the API key in your environment as `PERPLEXITY_API_KEY`.

### Step 3: Configure Claude Desktop

1. Download Claude desktop [here](https://claude.ai/download). 

2. Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perplexity-ask": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "PERPLEXITY_API_KEY",
        "mcp/perplexity-ask"
      ],
      "env": {
        "PERPLEXITY_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

### NPX

```json
{
  "mcpServers": {
    "perplexity-ask": {
      "command": "npx",
      "args": [
        "-y",
        "server-perplexity-ask"
      ],
      "env": {
        "PERPLEXITY_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

You can access the file using:

```bash
vim ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

### Step 4: Build the Docker Image

Docker build:

```bash
docker build -t mcp/perplexity-ask:latest -f Dockerfile .
```

### Step 5: Testing

Let's make sure Claude for Desktop is picking up the two tools we've exposed in our `perplexity-ask` server. You can do this by looking for the hammer icon:

![Claude Visual Tools](perplexity-ask/assets/visual-indicator-mcp-tools.png)

After clicking on the hammer icon, you should see the tools that come with the Filesystem MCP Server:

![Available Integration](perplexity-ask/assets/available_tools.png)

If you see both of these this means that the integration is active. Congratulations! This means Claude can now ask Perplexity. You can then simply use it as you would use the Perplexity web app.  

### Step 6: Advanced parameters

Currently, the search parameters used are the default ones. You can modify any search parameter in the API call directly in the `index.ts` script. For this, please refer to the official [API documentation](https://docs.perplexity.ai/api-reference/chat-completions).

### Troubleshooting 

The Claude documentation provides an excellent [troubleshooting guide](https://modelcontextprotocol.io/docs/tools/debugging) you can refer to. However, you can still reach out to us at api@perplexity.ai for any additional support or [file a bug](https://github.com/ppl-ai/api-discussion/issues). 


# Cursor integration

You can also use our MCP with Cursor (or any other app that supports this). To use Sonar with Cursor, you can follow the following steps. 

### Step 1: Navigate to your Cursor settings:

![Cursor Settings](perplexity-ask/assets/cursor-settings.png)

### Step 2: Navigate to the MCP directory

And click on `Add new global MCP server`

![Add Server](perplexity-ask/assets/cursor-mcp-directory.png)


### Step 3: Insert the MCP Server Configuration from above 

This is the same configuration you would use for any other application that supports MCP. 

You should then see the application being part of your available tools like this:

![Cursor MCP](perplexity-ask/assets/perplexity-ask-mcp-cursor.png)


## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.

