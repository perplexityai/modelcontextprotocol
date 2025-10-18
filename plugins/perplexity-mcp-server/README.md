# Perplexity MCP Server Plugin

Official Claude Code plugin for the Perplexity MCP Server, providing AI assistants with real-time web search, reasoning, and research capabilities through Sonar models and the Search API.

## Features

- **perplexity_search**: Direct web search using the Perplexity Search API with ranked results and metadata
- **perplexity_ask**: General-purpose conversational AI with real-time web search using the `sonar-pro` model
- **perplexity_research**: Deep, comprehensive research using the `sonar-deep-research` model
- **perplexity_reason**: Advanced reasoning and problem-solving using the `sonar-reasoning-pro` model

## Installation

### Prerequisites

1. Get your Perplexity API Key from the [API Portal](https://www.perplexity.ai/account/api/group)
2. Have Claude Code installed and running

### Quick Install

1. Add the Perplexity marketplace to Claude Code:
   ```
   /plugin marketplace add perplexityai/modelcontextprotocol
   ```

2. Install the plugin:
   ```
   /plugin install perplexity-mcp-server@perplexity
   ```

3. Configure your API key when prompted, or set it manually in your Claude Code settings.

### Manual Configuration

If you need to set your API key manually:

1. Open Claude Code settings
2. Navigate to MCP Servers
3. Find the "perplexity" server configuration
4. Set the `PERPLEXITY_API_KEY` environment variable to your API key
5. Optionally adjust `PERPLEXITY_TIMEOUT_MS` (default: 300000ms = 5 minutes)

## Usage

Once installed, you can use the Perplexity tools in your conversations with Claude:

- Ask questions that require current information
- Request research on specific topics
- Ask for reasoning through complex problems
- Search for specific information on the web

Claude will automatically use the appropriate Perplexity tool based on your request.

## Troubleshooting

- **API Key Issues**: Ensure `PERPLEXITY_API_KEY` is set correctly in your MCP server configuration
- **Connection Errors**: Check your internet connection and API key validity
- **Timeout Errors**: For very long research queries, increase `PERPLEXITY_TIMEOUT_MS` value

## Support

For support:
- Visit [community.perplexity.ai](https://community.perplexity.ai)
- [File an issue](https://github.com/perplexityai/modelcontextprotocol/issues) on GitHub
- Check the [official documentation](https://docs.perplexity.ai/guides/mcp-server)
