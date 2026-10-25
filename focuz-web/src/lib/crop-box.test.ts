import { describe, expect, it } from 'vitest'
import { centeredCrop, flipCropH, moveCrop, resizeCrop, rotateCropLeft } from './crop-box'

describe('crop box', () => {
  it('starts with the whole picture, or the biggest centred square', () => {
    expect(centeredCrop(400, 300, null)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    expect(centeredCrop(400, 300, 1)).toEqual({ x: 50, y: 0, width: 300, height: 300 })
  })

  it('moves inside the picture only', () => {
    expect(moveCrop({ x: 50, y: 0, width: 300, height: 300 }, 500, -20, 400, 300)).toEqual({ x: 100, y: 0, width: 300, height: 300 })
  })

  it('moves one side at a time without a shape, and never below the minimum', () => {
    const c = { x: 0, y: 0, width: 400, height: 300 }
    expect(resizeCrop(c, 'e', -100, 50, 400, 300, null, 40)).toEqual({ x: 0, y: 0, width: 300, height: 300 })
    expect(resizeCrop(c, 'nw', 390, 10, 400, 300, null, 40)).toEqual({ x: 360, y: 10, width: 40, height: 290 })
  })

  it('keeps a square from the opposite corner and stays inside', () => {
    const c = { x: 50, y: 0, width: 300, height: 300 }
    // Dragging the bottom-right corner up and left shrinks it; the top-left corner stays.
    expect(resizeCrop(c, 'se', -100, -150, 400, 300, 1, 40)).toEqual({ x: 50, y: 0, width: 200, height: 200 })
    // Dragging the top-left corner out is stopped by the top of the picture.
    expect(resizeCrop(c, 'nw', -50, -50, 400, 300, 1, 40)).toEqual({ x: 50, y: 0, width: 300, height: 300 })
  })

  it('follows a quarter turn and a flip', () => {
    // 400×300 picture, frame at the top-left; turned left the picture is 300×400 and the frame is at the bottom-left.
    expect(rotateCropLeft({ x: 0, y: 0, width: 100, height: 50 }, 400)).toEqual({ x: 0, y: 300, width: 50, height: 100 })
    expect(flipCropH({ x: 0, y: 0, width: 100, height: 50 }, 400)).toEqual({ x: 300, y: 0, width: 100, height: 50 })
  })
})
