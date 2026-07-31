import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const downloadMyProfilePhoto = vi.hoisted(() => vi.fn())

vi.mock('@/services/telegram/gateway', () => ({
  telegramAccountGateway: { downloadMyProfilePhoto },
}))

import { useAccountProfilePhotos } from '@/composables/useAccountProfilePhotos'

describe('useAccountProfilePhotos', () => {
  const profilePhotos = useAccountProfilePhotos()

  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:profile-photo')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    profilePhotos.pruneAccountProfilePhotos(new Set())
    vi.clearAllMocks()
  })

  afterEach(() => {
    profilePhotos.pruneAccountProfilePhotos(new Set())
    vi.restoreAllMocks()
  })

  it('deduplicates concurrent loads and reuses the cached object URL', async () => {
    let resolvePhoto!: (blob: Blob | null) => void
    downloadMyProfilePhoto.mockReturnValue(
      new Promise<Blob | null>((resolve) => {
        resolvePhoto = resolve
      }),
    )

    const firstLoad = profilePhotos.loadAccountProfilePhoto('account-a')
    const secondLoad = profilePhotos.loadAccountProfilePhoto('account-a')
    resolvePhoto(new Blob(['photo'], { type: 'image/jpeg' }))

    await expect(firstLoad).resolves.toBe('blob:profile-photo')
    await expect(secondLoad).resolves.toBe('blob:profile-photo')
    await expect(profilePhotos.loadAccountProfilePhoto('account-a')).resolves.toBe(
      'blob:profile-photo',
    )
    expect(downloadMyProfilePhoto).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(profilePhotos.photoUrlFor('account-a')).toBe('blob:profile-photo')
  })

  it('revokes cached URLs when their local account is removed', async () => {
    downloadMyProfilePhoto.mockResolvedValue(new Blob(['photo'], { type: 'image/jpeg' }))
    await profilePhotos.loadAccountProfilePhoto('account-a')

    profilePhotos.pruneAccountProfilePhotos(new Set())

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:profile-photo')
    expect(profilePhotos.photoUrlFor('account-a')).toBeNull()
  })

  it('does not publish a photo that settles after the account was discarded', async () => {
    let resolvePhoto!: (blob: Blob | null) => void
    downloadMyProfilePhoto.mockReturnValue(
      new Promise<Blob | null>((resolve) => {
        resolvePhoto = resolve
      }),
    )
    const load = profilePhotos.loadAccountProfilePhoto('account-a')

    profilePhotos.discardAccountProfilePhoto('account-a')
    resolvePhoto(new Blob(['photo'], { type: 'image/jpeg' }))

    await expect(load).resolves.toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(profilePhotos.photoUrlFor('account-a')).toBeNull()
  })
})
