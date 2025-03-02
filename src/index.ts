#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import open from "open";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { optimize } from "svgo";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, "..", "images");

// Define error types
enum EverArtErrorType {
  API_ERROR = "API_ERROR",
  AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  STORAGE_ERROR = "STORAGE_ERROR",
  FORMAT_ERROR = "FORMAT_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR"
}

interface EverArtError {
  type: EverArtErrorType;
  message: string;
  details?: any;
}

// Helper function for error responses
function errorResponse(error: EverArtError): { content: any[], isError: boolean } {
  console.error(`[${error.type}] ${error.message}`, error.details || '');
  return {
    content: [
      { type: "text", text: `Error: ${error.message}` },
      ...(error.details ? [{ type: "text", text: `Details: ${JSON.stringify(error.details, null, 2)}` }] : []),
    ],
    isError: true,
  };
}

const server = new Server(
  {
    name: "everart-forge-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
);

// API key validation with better error message
if (!process.env.EVERART_API_KEY) {
  console.error("ERROR: EVERART_API_KEY environment variable is not set. Please add your EverArt API key to the MCP settings.");
  process.exit(1);
}

// Constants for retry logic
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

// Import and initialize EverArt client with better type definition
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const EverArt = require('everart');

interface EverArtClient {
  v1: {
    generations: {
      create: (model: string, prompt: string, mode: string, options: any) => Promise<any[]>;
      fetchWithPolling: (generationId: string, options?: { maxAttempts?: number, interval?: number }) => Promise<any>;
    }
  }
}

let client: EverArtClient;
try {
  console.error("Initializing EverArt client...");
  client = new EverArt.default(process.env.EVERART_API_KEY!);
  console.error("EverArt client initialized successfully");
} catch (error) {
  console.error("Failed to initialize EverArt client:", error);
  console.error("Please check your API key and network connection.");
  process.exit(1);
}

// Ensure storage directory exists with better error handling
async function ensureStorageDir() {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    console.error("Failed to create storage directory:", error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to create storage directory: ${(error as Error).message}`
    );
  }
}

// Get the correct MIME type for a file format
function getMimeType(format: string): string {
  switch (format.toLowerCase()) {
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

// Validate model and format compatibility
function validateModelFormatCompatibility(model: string, format: string): boolean {
  // SVG is only supported by Recraft-Vector (8000)
  if (format.toLowerCase() === 'svg' && model !== '8000') {
    return false;
  }
  return true;
}

// Process and validate web project paths
async function processWebProjectPath(basePath?: string, projectType?: string, assetPath?: string): Promise<string | undefined> {
  if (!basePath) return undefined;
  
  try {
    // Construct full path
    let fullPath = basePath;
    
    // If it's a web project, add appropriate structure
    if (projectType) {
      // Check for common web project structure patterns
      switch (projectType.toLowerCase()) {
        case 'react':
        case 'vue':
        case 'angular':
          fullPath = path.join(basePath, 'public', assetPath || 'images');
          break;
        case 'next':
        case 'nuxt':
          fullPath = path.join(basePath, 'public', assetPath || 'images');
          break;
        case 'html':
        case 'static':
        default:
          fullPath = path.join(basePath, assetPath || 'assets/images');
          break;
      }
    } else if (assetPath) {
      fullPath = path.join(basePath, assetPath);
    }
    
    // Ensure directory exists
    await fs.mkdir(fullPath, { recursive: true });
    
    return fullPath;
  } catch (error) {
    console.error(`Failed to process web project path: ${(error as Error).message}`);
    return undefined;
  }
}

// Enhanced image saving with better error handling and format validation
async function saveImage(imageUrl: string, prompt: string, model: string, format: string = "svg", outputPath?: string, webProjectPath?: string, projectType?: string, assetPath?: string): Promise<string> {
  // Validate format
  format = format.toLowerCase();
  const supportedFormats = ['svg', 'png', 'jpg', 'jpeg', 'webp'];
  if (!supportedFormats.includes(format)) {
    throw new Error(`Unsupported format: ${format}. Supported formats are: ${supportedFormats.join(', ')}`);
  }
  
  // Validate model/format compatibility
  if (!validateModelFormatCompatibility(model, format)) {
    throw new Error(`Format '${format}' is not compatible with model '${model}'. SVG format is only available with Recraft-Vector (8000) model.`);
  }
  
  let filepath: string;
  
  try {
    // Handle web project paths if specified
    let projectBasePath: string | undefined;
    if (webProjectPath) {
      projectBasePath = await processWebProjectPath(webProjectPath, projectType, assetPath);
    }
    
    // Generate a standardized file name for web assets
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedPrompt = prompt.slice(0, 20).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const filename = `${sanitizedPrompt}_${model}.${format}`;
    
    if (outputPath) {
      // If outputPath is provided, ensure it has the correct extension
      const ext = path.extname(outputPath);
      if (!ext) {
        // If no extension provided, append the format
        filepath = `${outputPath}.${format}`;
      } else if (ext.slice(1).toLowerCase() !== format.toLowerCase()) {
        // If extension doesn't match format, warn but use the specified format
        console.warn(`Warning: File extension ${ext} doesn't match specified format ${format}`);
        filepath = outputPath.slice(0, -ext.length) + `.${format}`;
      } else {
        filepath = outputPath;
      }
      
      // Ensure the directory exists
      await fs.mkdir(path.dirname(filepath), { recursive: true });
    } else if (projectBasePath) {
      // Web project path takes precedence over default
      filepath = path.join(projectBasePath, filename);
    } else {
      // Default behavior: save to STORAGE_DIR with timestamp
      filepath = path.join(STORAGE_DIR, `${timestamp}_${model}_${sanitizedPrompt}.${format}`);
    }

    // Fetch the image with retries
    let response;
    let retryCount = 0;
    
    while (retryCount < MAX_RETRIES) {
      try {
        // @ts-ignore - node-fetch doesn't support timeout in RequestInit, but this works at runtime
        response = await fetch(imageUrl, { timeout: 30000 });
        if (response.ok) break;
        
        // If we got a 429 (rate limit), wait longer before retrying
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
        } else {
          throw new Error(`Failed to fetch image: ${response.statusText} (${response.status})`);
        }
      } catch (error) {
        if (retryCount >= MAX_RETRIES - 1) throw error;
        
        // Exponential backoff
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
        await new Promise(r => setTimeout(r, delay));
      }
      
      retryCount++;
    }
    
    if (!response || !response.ok) {
      throw new Error(`Failed to fetch image after ${MAX_RETRIES} attempts`);
    }

    const buffer = await response.arrayBuffer();
    const content = Buffer.from(buffer);

    if (format === "svg") {
      // For SVG, optimize and save
      const svgString = content.toString('utf-8');
      const result = optimize(svgString, {
        multipass: true,
        plugins: [
          'preset-default',
          'removeDimensions',
          'removeViewBox',
          'cleanupIds',
        ],
      });
      await fs.writeFile(filepath, result.data);
    } else {
      // For raster formats, convert using sharp with better error handling
      try {
        const image = sharp(content);
        switch (format.toLowerCase()) {
          case "png":
            await image.png({ quality: 90 }).toFile(filepath);
            break;
          case "jpg":
          case "jpeg":
            await image.jpeg({ quality: 90 }).toFile(filepath);
            break;
          case "webp":
            await image.webp({ quality: 90 }).toFile(filepath);
            break;
          default:
            throw new Error(`Unsupported format: ${format}`);
        }
      } catch (error) {
        throw new Error(`Image processing failed: ${(error as Error).message}`);
      }
    }

    return filepath;
  } catch (error) {
    throw new Error(`Failed to save image: ${(error as Error).message}`);
  }
}

// List stored images
async function listStoredImages(): Promise<string[]> {
  try {
    const files = await fs.readdir(STORAGE_DIR);
    return files.filter((file: string) => /\.(svg|png|jpe?g|webp)$/i.test(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

// Helper for handling API errors in a user-friendly way
function handleApiError(error: any): EverArtError {
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    if (error.response.status === 401 || error.response.status === 403) {
      return {
        type: EverArtErrorType.AUTHENTICATION_ERROR,
        message: "Authentication failed. Please check your API key.",
        details: error.response.data
      };
    } else if (error.response.status === 429) {
      return {
        type: EverArtErrorType.API_ERROR,
        message: "Rate limit exceeded. Please try again later.",
        details: error.response.data
      };
    } else {
      return {
        type: EverArtErrorType.API_ERROR,
        message: `API error: ${error.response.data?.message || error.response.statusText}`,
        details: error.response.data
      };
    }
  } else if (error.request) {
    // The request was made but no response was received
    return {
      type: EverArtErrorType.NETWORK_ERROR,
      message: "Network error. Failed to connect to EverArt API.",
      details: error.message
    };
  } else {
    // Something happened in setting up the request that triggered an Error
    return {
      type: EverArtErrorType.UNKNOWN_ERROR,
      message: error.message || "Unknown error occurred",
      details: error
    };
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description:
        "Generate images using EverArt Models, optimized for web development. " +
        "Supports web project paths, responsive formats, and inline preview. " +
        "Available models:\n" +
        "- 5000:FLUX1.1: Standard quality\n" +
        "- 9000:FLUX1.1-ultra: Ultra high quality\n" +
        "- 6000:SD3.5: Stable Diffusion 3.5\n" +
        "- 7000:Recraft-Real: Photorealistic style\n" +
        "- 8000:Recraft-Vector: Vector art style (SVG format)",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Text description of desired image",
          },
          model: {
            type: "string",
            description:
              "Model ID (5000:FLUX1.1, 9000:FLUX1.1-ultra, 6000:SD3.5, 7000:Recraft-Real, 8000:Recraft-Vector)",
            default: "5000",
          },
          format: {
            type: "string",
            description: "Output format (svg, png, jpg, webp). Note: Vector format (svg) is only available with Recraft-Vector (8000) model.",
            default: "svg"
          },
          output_path: {
            type: "string",
            description: "Optional: Custom output path for the generated image. If not provided, image will be saved in the default storage directory.",
          },
          web_project_path: {
            type: "string",
            description: "Path to web project root folder for storing images in appropriate asset directories.",
          },
          project_type: {
            type: "string",
            description: "Web project type to determine appropriate asset directory structure (e.g., 'react', 'vue', 'html', 'next').",
          },
          asset_path: {
            type: "string",
            description: "Optional subdirectory within the web project's asset structure for storing generated images.",
          },
          image_count: {
            type: "number",
            description: "Number of images to generate",
            default: 1,
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "list_images",
      description: "List all stored images",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "view_image",
      description: "Open a stored image in the default image viewer",
      inputSchema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Name of the image file to view",
          },
        },
        required: ["filename"],
      },
    },
  ],
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const files = await listStoredImages();
    return {
      resources: files.map(file => {
        // Determine correct MIME type based on file extension
        const ext = path.extname(file).slice(1).toLowerCase();
        const mimeType = getMimeType(ext);
        
        return {
          uri: `everart-forge-mcp://images/${file}`,
          mimeType,
          name: file,
        };
      }),
    };
  } catch (error) {
    console.error("Failed to list resources:", error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list image resources: ${(error as Error).message}`
    );
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const match = request.params.uri.match(/^everart-forge-mcp:\/\/images\/(.+)$/);
  if (!match) {
    throw new McpError(
      ErrorCode.InvalidRequest, 
      `Invalid URI format: ${request.params.uri}. Expected format: everart-forge-mcp://images/filename`
    );
  }

  const filename = match[1];
  const filepath = path.join(STORAGE_DIR, filename);

  try {
    const content = await fs.readFile(filepath);
    
    // Determine correct MIME type based on file extension
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeType = getMimeType(ext);
    
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType,
          blob: content.toString("base64"),
        },
      ],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new McpError(
        404, // Use standard HTTP 404 code
        `Image not found: ${filename}. Please check if the file exists in the storage directory.`
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to read image: ${(error as Error).message}`
    );
  }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    await ensureStorageDir();
  } catch (error) {
    return errorResponse({
      type: EverArtErrorType.STORAGE_ERROR,
      message: `Failed to ensure storage directory: ${(error as Error).message}`
    });
  }

  switch (request.params.name) {
    case "generate_image": {
      try {
        const args = request.params.arguments as any;
        
        // Validate required parameters
        if (!args.prompt || typeof args.prompt !== 'string' || args.prompt.trim() === '') {
          return errorResponse({
            type: EverArtErrorType.VALIDATION_ERROR,
            message: "Prompt is required and must be a non-empty string."
          });
        }
        
        const prompt = args.prompt;
        // Use 'let' instead of 'const' for model since we might need to modify it
        let modelInput = args.model || "5000";
        const image_count = args.image_count || 1;
        const output_path = args.output_path;
        const web_project_path = args.web_project_path;
        const project_type = args.project_type;
        const asset_path = args.asset_path;
        
        // Enhanced validation
        if (image_count < 1 || image_count > 10) {
          return errorResponse({
            type: EverArtErrorType.VALIDATION_ERROR,
            message: "image_count must be between 1 and 10"
          });
        }
        
        // Validate model - extract the numeric ID if a combined format was provided
        const validModels = ["5000", "6000", "7000", "8000", "9000"];
        
        // Handle model IDs in the format "8000:Recraft-Vector"
        if (modelInput.includes(":")) {
          const originalModel = modelInput;
          modelInput = modelInput.split(":")[0];
          console.log(`Received combined model ID format: ${originalModel}, using base ID: ${modelInput}`);
        }
        
        if (!validModels.includes(modelInput)) {
          return errorResponse({
            type: EverArtErrorType.VALIDATION_ERROR,
            message: `Invalid model ID: ${modelInput}. Valid models are: ${validModels.join(", ")}`
          });
        }
        
        // Now we have the validated model ID
        const format = args.format || (modelInput === "8000" ? "svg" : "png");
        
        // Validate format
        const supportedFormats = ["svg", "png", "jpg", "jpeg", "webp"];
        if (!supportedFormats.includes(format.toLowerCase())) {
          return errorResponse({
            type: EverArtErrorType.VALIDATION_ERROR,
            message: `Unsupported format: ${format}. Supported formats are: ${supportedFormats.join(", ")}`
          });
        }
        
        // Validate model/format compatibility
        if (!validateModelFormatCompatibility(modelInput, format)) {
          return errorResponse({
            type: EverArtErrorType.VALIDATION_ERROR,
            message: `Format '${format}' is not compatible with model '${modelInput}'. SVG format is only available with Recraft-Vector (8000) model.`
          });
        }
        
        // Generate image with retry logic
        let generation;
        let retryCount = 0;
        
        while (retryCount < MAX_RETRIES) {
          try {
            generation = await client.v1.generations.create(
              modelInput,
              prompt,
              "txt2img",
              {
                imageCount: image_count,
                height: 1024,
                width: 1024,
                // Add extra fields for specific models if needed
                ...(modelInput === "8000" ? { variant: "vector" } : {}),
              },
            );
            break;
          } catch (error) {
            if (retryCount >= MAX_RETRIES - 1) throw error;
            
            // Exponential backoff
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
            await new Promise(r => setTimeout(r, delay));
            retryCount++;
          }
        }
        
        if (!generation) {
          throw new Error("Failed to create generation after multiple attempts");
        }

        // Enhanced polling with better timeout handling
        const completedGen = await client.v1.generations.fetchWithPolling(
          generation[0].id,
          { 
            maxAttempts: 30,  // Increased from default
            interval: 3000    // Check every 3 seconds
          }
        );

        const imgUrl = completedGen.image_url;
        if (!imgUrl) {
          throw new Error("No image URL in the completed generation");
        }

        // Save image locally with specified format and path
        const filepath = await saveImage(
          imgUrl, 
          prompt, 
          modelInput, 
          format, 
          output_path, 
          web_project_path, 
          project_type, 
          asset_path
        );

        // Open in default viewer
        try {
          await open(filepath);
        } catch (openError) {
          console.warn("Could not open the image in default viewer:", openError);
          // Continue without throwing - this is a non-critical error
        }

        // Model name mapping for user-friendly display
        const modelNames: Record<string, string> = {
          "5000": "FLUX1.1 (Standard quality)",
          "9000": "FLUX1.1-ultra (Ultra high quality)",
          "6000": "Stable Diffusion 3.5",
          "7000": "Recraft-Real (Photorealistic)",
          "8000": "Recraft-Vector (Vector art)"
        };

        // Read the image file for inline display
        let imageData: string | undefined;
        try {
          const imageContent = await fs.readFile(filepath);
          imageData = imageContent.toString('base64');
        } catch (error) {
          console.warn("Unable to read image for inline display:", error);
          // Continue without inline display if reading fails
        }

        // Calculate relative web path if applicable
        let webRelativePath: string | undefined;
        if (web_project_path && filepath.startsWith(web_project_path)) {
          webRelativePath = filepath.slice(web_project_path.length);
          if (!webRelativePath.startsWith('/')) webRelativePath = '/' + webRelativePath;
        }

        return {
          content: [
            {
              type: "text", 
              text: `✅ Image generated and saved successfully!\n\n` +
                   `Generation details:\n` +
                   `• Model: ${modelNames[modelInput] || modelInput}\n` +
                   `• Prompt: "${prompt}"\n` +
                   `• Format: ${format.toUpperCase()}\n` +
                   `• Saved to: ${filepath}` +
                   (webRelativePath ? `\n• Web relative path: ${webRelativePath}` : ``)
            },
            {
              type: "text",
              text: `View the image at: file://${filepath}`
            }
          ],
        };
      } catch (error: unknown) {
        console.error("Detailed error:", error);
        
        // Categorize errors for better user feedback
        if (error instanceof Error) {
          if (error.message.includes("SVG format")) {
            return errorResponse({
              type: EverArtErrorType.FORMAT_ERROR,
              message: error.message
            });
          } else if (error.message.includes("Failed to fetch image")) {
            return errorResponse({
              type: EverArtErrorType.NETWORK_ERROR,
              message: "Failed to download the generated image. Please check your internet connection and try again."
            });
          } else if (error.message.includes("rate limit")) {
            return errorResponse({
              type: EverArtErrorType.API_ERROR,
              message: "EverArt API rate limit reached. Please try again later."
            });
          } else if (error.message.includes("unauthorized") || error.message.includes("authentication")) {
            return errorResponse({
              type: EverArtErrorType.AUTHENTICATION_ERROR,
              message: "API authentication failed. Please check your EverArt API key."
            });
          }
        }
        
        // Generic error handling
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return errorResponse({
          type: EverArtErrorType.UNKNOWN_ERROR,
          message: errorMessage
        });
      }
    }

    case "list_images": {
      try {
        const files = await listStoredImages();
        if (files.length === 0) {
          return {
            content: [{ type: "text", text: "No stored images found. Try generating some images first!" }],
          };
        }

        // Group files by type for better display
        const filesByType: Record<string, string[]> = {};
        
        for (const file of files) {
          const ext = path.extname(file).slice(1).toLowerCase();
          if (!filesByType[ext]) {
            filesByType[ext] = [];
          }
          filesByType[ext].push(file);
        }
        
        let resultText = "📁 Stored images:\n\n";
        
        for (const [type, typeFiles] of Object.entries(filesByType)) {
          resultText += `${type.toUpperCase()} Files (${typeFiles.length}):\n`;
          resultText += typeFiles.map(f => `• ${f}`).join("\n");
          resultText += "\n\n";
        }
        
        resultText += `Total: ${files.length} file(s)`;
        
        // Add file URLs instead of trying to embed images
        const recentFiles = files.slice(-5);
        const fileUrls: string[] = [];
        
        for (const file of recentFiles) {
          const filepath = path.join(STORAGE_DIR, file);
          fileUrls.push(`file://${filepath}`);
        }
        
        return {
          content: [
            { type: "text", text: resultText },
            ...(fileUrls.length > 0 ? [{ 
              type: "text", 
              text: "\nRecent images:\n" + fileUrls.map(url => `• ${url}`).join('\n')
            }] : []),
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return errorResponse({
          type: EverArtErrorType.STORAGE_ERROR,
          message: `Error listing images: ${errorMessage}`
        });
      }
    }

    case "view_image": {
      try {
        const args = request.params.arguments as any;
        
        // Validate filename
        if (!args.filename || typeof args.filename !== 'string') {
          return errorResponse({
            type: EverArtErrorType.VALIDATION_ERROR,
            message: "filename is required and must be a string"
          });
        }
        
        const filename = args.filename;
        const filepath = path.join(STORAGE_DIR, filename);

        try {
          // Check if file exists
          await fs.access(filepath);
        } catch (accessError) {
          // List available files to help the user
          const availableFiles = await listStoredImages();
          let errorMsg = `Image not found: ${filename}`;
          
          if (availableFiles.length > 0) {
            const suggestions = availableFiles
              .filter(f => f.toLowerCase().includes(filename.toLowerCase()) || 
                          filename.toLowerCase().includes(f.toLowerCase().split('_').pop() || ''))
              .slice(0, 3);
              
            if (suggestions.length > 0) {
              errorMsg += `\n\nDid you mean one of these?\n` + 
                        suggestions.map(s => `• ${s}`).join('\n');
            }
            
            errorMsg += `\n\nUse 'list_images' to see all available images.`;
          }
          
          return errorResponse({
            type: EverArtErrorType.VALIDATION_ERROR,
            message: errorMsg
          });
        }

        // Read the image for inline display
        let imageData: string | undefined;
        let mimeType: string = 'application/octet-stream';
        
        try {
          const content = await fs.readFile(filepath);
          imageData = content.toString('base64');
          const ext = path.extname(filename).slice(1).toLowerCase();
          mimeType = getMimeType(ext);
        } catch (error) {
          console.warn("Unable to read image for inline display:", error);
          // Continue without inline display if reading fails
        }

        await open(filepath);
        
        // Skip opening in external viewer since we'll show in MCP
        try {
          // If we got here, cancel the auto-open to avoid duplicate windows
          // await open(filepath);
        } catch (openError) {
          // Ignore error
        }
        
        return {
          content: [
            { 
              type: "text", 
              text: `✅ Viewing image: ${filename}` 
            },
            {
              type: "text",
              text: `Image opened in default viewer.\nFile path: file://${filepath}`
            }
          ],
        };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return errorResponse({
          type: EverArtErrorType.UNKNOWN_ERROR,
          message: `Error viewing image: ${errorMessage}`
        });
      }
    }

    default:
      return errorResponse({
        type: EverArtErrorType.VALIDATION_ERROR,
        message: `Unknown tool: ${request.params.name}`
      });
  }
});

async function runServer() {
  await ensureStorageDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("EverArt Forge MCP Server running on stdio");
}

runServer().catch(console.error);
