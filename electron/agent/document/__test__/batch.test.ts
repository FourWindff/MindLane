import { describe, it, expect } from 'vitest'
import { Document } from '@langchain/core/documents'
import { batchDocuments, computeBudgetChars } from '../batch.js'

function doc(text: string): Document {
  return new Document({ pageContent: text })
}

function docsOf(lengths: number[]): Document[] {
  return lengths.map((len) => doc('x'.repeat(len)))
}

function batchSizes(batches: Document[][]): number[] {
  return batches.map((batch) => batch.reduce((sum, d) => sum + d.pageContent.length, 0))
}

describe('computeBudgetChars', () => {
  it('converts to window × 40% × 2 chars', () => {
    expect(computeBudgetChars(32_768)).toBe(26_214)
    expect(computeBudgetChars(128_000)).toBe(102_400)
  })
})

describe('batchDocuments', () => {
  const cases: Array<{ name: string; lengths: number[]; budget: number; expected: number[] }> = [
    {
      name: 'packs chunks within budget into one batch',
      lengths: [100, 100],
      budget: 300,
      expected: [200],
    },
    {
      name: 'starts a new batch when over budget',
      lengths: [100, 100, 100],
      budget: 250,
      expected: [200, 100],
    },
    {
      name: 'gives an oversized single chunk its own batch',
      lengths: [100, 500, 100],
      budget: 200,
      expected: [100, 500, 100],
    },
    {
      name: 'does not split early when exactly at budget',
      lengths: [100, 100],
      budget: 200,
      expected: [200],
    },
    {
      name: 'batches normal chunks around an oversized one',
      lengths: [500, 100, 100],
      budget: 200,
      expected: [500, 200],
    },
  ]

  for (const { name, lengths, budget, expected } of cases) {
    it(name, () => {
      const batches = batchDocuments(docsOf(lengths), budget)
      expect(batchSizes(batches)).toEqual(expected)
    })
  }

  it('returns an empty array for empty input', () => {
    expect(batchDocuments([], 1000)).toEqual([])
  })

  it('keeps every chunk in original order', () => {
    const input = docsOf([100, 500, 100, 100])
    const batches = batchDocuments(input, 200)
    expect(batches.flat()).toEqual(input)
  })
})
