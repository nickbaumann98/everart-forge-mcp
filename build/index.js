#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, McpError, ErrorCode, } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import open from "open";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { optimize } from "svgo";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, "..", "images");
const server = new Server({
    name: "everart-storage",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
        resources: {},
    },
});
if (!process.env.EVERART_API_KEY) {
    console.error("EVERART_API_KEY environment variable is not set");
    process.exit(1);
}
// Import and initialize EverArt client
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const EverArt = require('everart');
let client;
try {
    console.error("Initializing EverArt client...");
    client = new EverArt.default(process.env.EVERART_API_KEY);
    console.error("EverArt client initialized successfully");
}
catch (error) {
    console.error("Failed to initialize EverArt client:", error);
    process.exit(1);
}
// Ensure storage directory exists
async function ensureStorageDir() {
    try {
        await fs.mkdir(STORAGE_DIR, { recursive: true });
    }
    catch (error) {
        console.error("Failed to create storage directory:", error);
        throw error;
    }
}
// Save image to local storage with format conversion
async function saveImage(imageUrl, prompt, model, format = "svg", outputPath) {
    let filepath;
    if (outputPath) {
        // If outputPath is provided, ensure it has the correct extension
        const ext = path.extname(outputPath);
        if (!ext) {
            // If no extension provided, append the format
            filepath = `${outputPath}.${format}`;
        }
        else if (ext.slice(1).toLowerCase() !== format.toLowerCase()) {
            // If extension doesn't match format, warn but use the specified format
            console.warn(`Warning: File extension ${ext} doesn't match specified format ${format}`);
            filepath = outputPath.slice(0, -ext.length) + `.${format}`;
        }
        else {
            filepath = outputPath;
        }
        // Ensure the directory exists
        await fs.mkdir(path.dirname(filepath), { recursive: true });
    }
    else {
        // Default behavior: save to STORAGE_DIR with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const sanitizedPrompt = prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, "_");
        const filename = `${timestamp}_${model}_${sanitizedPrompt}.${format}`;
        filepath = path.join(STORAGE_DIR, filename);
    }
    const response = await fetch(imageUrl);
    if (!response.ok)
        throw new Error(`Failed to fetch image: ${response.statusText}`);
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
    }
    else {
        // For raster formats, convert using sharp
        const image = sharp(content);
        switch (format.toLowerCase()) {
            case "png":
                await image.png().toFile(filepath);
                break;
            case "jpg":
            case "jpeg":
                await image.jpeg().toFile(filepath);
                break;
            case "webp":
                await image.webp().toFile(filepath);
                break;
            default:
                throw new Error(`Unsupported format: ${format}`);
        }
    }
    return filepath;
}
// List stored images
async function listStoredImages() {
    try {
        const files = await fs.readdir(STORAGE_DIR);
        return files.filter((file) => /\.(svg|png|jpe?g|webp)$/i.test(file));
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "generate_image",
            description: "Generate images using EverArt Models, saves locally and returns file path. " +
                "Available models:\n" +
                "- 5000:FLUX1.1: Standard quality\n" +
                "- 9000:FLUX1.1-ultra: Ultra high quality\n" +
                "- 6000:SD3.5: Stable Diffusion 3.5\n" +
                "- 7000:Recraft-Real: Photorealistic style\n" +
                "- 8000:Recraft-Vector: Vector art style",
            inputSchema: {
                type: "object",
                properties: {
                    prompt: {
                        type: "string",
                        description: "Text description of desired image",
                    },
                    model: {
                        type: "string",
                        description: "Model ID (5000:FLUX1.1, 9000:FLUX1.1-ultra, 6000:SD3.5, 7000:Recraft-Real, 8000:Recraft-Vector)",
                        default: "5000",
                    },
                    image_count: {
                        type: "number",
                        description: "Number of images to generate",
                        default: 1,
                    },
                    format: {
                        type: "string",
                        description: "Output format (svg, png, jpg, webp). Note: Vector format (svg) is only available with Recraft-Vector model.",
                        default: "svg"
                    },
                    output_path: {
                        type: "string",
                        description: "Optional: Custom output path for the generated image. If not provided, image will be saved in the default storage directory.",
                    }
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
    const files = await listStoredImages();
    return {
        resources: files.map(file => ({
            uri: `everart-storage://images/${file}`,
            mimeType: "image/png",
            name: file,
        })),
    };
});
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const match = request.params.uri.match(/^everart-storage:\/\/images\/(.+)$/);
    if (!match) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid URI format: ${request.params.uri}`);
    }
    const filename = match[1];
    const filepath = path.join(STORAGE_DIR, filename);
    try {
        const content = await fs.readFile(filepath);
        return {
            contents: [
                {
                    uri: request.params.uri,
                    mimeType: "image/png",
                    blob: content.toString("base64"),
                },
            ],
        };
    }
    catch (error) {
        if (error.code === "ENOENT") {
            throw new McpError(404, `Image not found: ${filename}`);
        }
        throw error;
    }
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    await ensureStorageDir();
    switch (request.params.name) {
        case "generate_image": {
            try {
                const { prompt, model = "5000", image_count = 1, format = model === "8000" ? "svg" : "png", output_path, } = request.params.arguments;
                // Validate format based on model
                if (format === "svg" && model !== "8000") {
                    throw new Error("SVG format is only available with the Recraft-Vector (8000) model");
                }
                const generation = await client.v1.generations.create(model, prompt, "txt2img", {
                    imageCount: image_count,
                    height: 1024,
                    width: 1024,
                });
                const completedGen = await client.v1.generations.fetchWithPolling(generation[0].id);
                const imgUrl = completedGen.image_url;
                if (!imgUrl)
                    throw new Error("No image URL");
                // Save image locally with specified format and path
                const filepath = await saveImage(imgUrl, prompt, model, format, output_path);
                // Open in default viewer
                await open(filepath);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Image generated and saved successfully!\n\nGeneration details:\n- Model: ${model}\n- Prompt: "${prompt}"\n- Saved to: ${filepath}\n\nThe image has been opened in your default viewer.`,
                        },
                    ],
                };
            }
            catch (error) {
                console.error("Detailed error:", error);
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                return {
                    content: [{ type: "text", text: `Error: ${errorMessage}` }],
                    isError: true,
                };
            }
        }
        case "list_images": {
            try {
                const files = await listStoredImages();
                if (files.length === 0) {
                    return {
                        content: [{ type: "text", text: "No stored images found." }],
                    };
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: "Stored images:\n\n" + files.map(f => `- ${f}`).join("\n"),
                        },
                    ],
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                return {
                    content: [{ type: "text", text: `Error listing images: ${errorMessage}` }],
                    isError: true,
                };
            }
        }
        case "view_image": {
            try {
                const { filename } = request.params.arguments;
                const filepath = path.join(STORAGE_DIR, filename);
                try {
                    await fs.access(filepath);
                }
                catch {
                    return {
                        content: [{ type: "text", text: `Image not found: ${filename}` }],
                        isError: true,
                    };
                }
                await open(filepath);
                return {
                    content: [
                        { type: "text", text: `Opened image: ${filename}` },
                    ],
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                return {
                    content: [{ type: "text", text: `Error viewing image: ${errorMessage}` }],
                    isError: true,
                };
            }
        }
        default:
            throw new Error(`Unknown tool: ${request.params.name}`);
    }
});
async function runServer() {
    await ensureStorageDir();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("EverArt Storage MCP Server running on stdio");
}
runServer().catch(console.error);
