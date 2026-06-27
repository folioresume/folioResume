import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { PDFParse } from "pdf-parse";
import { GEMINI_MODEL, GROQ_MODEL } from "../config/env.js";
import { EXTRACTION_PROMPT } from "../constants/index.js";
import { cleanGeminiJson, getUploadErrorMessage } from "../utils/helpers.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

async function parseResumePdfWithGemini(filePath) {
  const base64Data = fs.readFileSync(filePath).toString("base64");
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: EXTRACTION_PROMPT },
          { inlineData: { mimeType: "application/pdf", data: base64Data } },
        ],
      },
    ],
    config: { thinkingConfig: { thinkingLevel: "low" } },
  });
  return JSON.parse(cleanGeminiJson(response.text));
}

async function parseResumePdfWithGroq(filePath) {
  if (!groq) throw new Error("GROQ_API_KEY is not configured on the backend.");

  const fileBuffer = fs.readFileSync(filePath);
  const parser = new PDFParse({});
  await parser.load(fileBuffer);
  const { text: pdfText } = await parser.getText();

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: "user", content: `${EXTRACTION_PROMPT}\n\nResume text:\n${pdfText}` }],
    temperature: 0,
  });
  return JSON.parse(cleanGeminiJson(completion.choices[0].message.content));
}

export async function parseResumePdf(filePath) {
  if (!process.env.GEMINI_API_KEY && !groq) {
    throw new Error("No AI provider configured. Set GEMINI_API_KEY or GROQ_API_KEY.");
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      return await parseResumePdfWithGemini(filePath);
    } catch (geminiError) {
      console.warn("Gemini parsing failed, falling back to Groq:", geminiError.message);
      if (!groq) throw geminiError;
    }
  }

  return parseResumePdfWithGroq(filePath);
}

export { getUploadErrorMessage };
