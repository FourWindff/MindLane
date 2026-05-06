import { z } from 'zod'
import type { MindmapYamlNode } from './types.js'

export const TreeSchema: z.ZodType<MindmapYamlNode> = z.lazy(() =>
  z.object({
    label: z.string().min(1),
    page_range: z.string().default(''),
    summary: z.string().optional(),
    children: z.array(TreeSchema).optional(),
  }),
)

export const LeafTaskSchema = z.object({
  chunks: z.array(z.object({
    id: z.string(),
    index: z.number(),
    startPage: z.number(),
    endPage: z.number(),
    text: z.string(),
  })).min(1),
  document: z.object({
    pdfPath: z.string(),
    title: z.string(),
    totalPages: z.number(),
    totalChars: z.number(),
  }),
})

export const LeafBatchOutputSchema = z.object({
  results: z.array(z.object({
    chunk_id: z.string(),
    mindmap: z.unknown(),
  })).min(1),
})

export const MergeTaskSchema = z.object({
  group: z.object({
    groupIndex: z.number(),
    trees: z.array(TreeSchema),
  }),
  round: z.number(),
  document: z.object({
    pdfPath: z.string(),
    title: z.string(),
    totalPages: z.number(),
    totalChars: z.number(),
  }),
})
