import { describe, expect, it } from 'vitest'
import { type MultiPeerResult, summarizeMultiPeerResult } from '@/types'

describe('summarizeMultiPeerResult', () => {
  it('tallies each outcome class and sums affected counts', () => {
    const result: MultiPeerResult = {
      outcomes: [
        { peerId: '1', status: 'delivered', affected: 3 },
        { peerId: '2', status: 'failed', affected: 0, error: 'nope' },
        { peerId: '3', status: 'skipped', affected: 0 },
        { peerId: '4', status: 'delivery_uncertain', affected: 1 },
        { peerId: '5', status: 'abandoned', affected: 0 },
        { peerId: '6', status: 'delivered', affected: 2 },
      ],
    }

    expect(summarizeMultiPeerResult(result)).toEqual({
      total: 6,
      succeeded: 2,
      failed: 1,
      skipped: 1,
      uncertain: 2,
      affected: 6,
    })
  })

  it('returns zeroes for an empty result', () => {
    expect(summarizeMultiPeerResult({ outcomes: [] })).toEqual({
      total: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      uncertain: 0,
      affected: 0,
    })
  })
})
