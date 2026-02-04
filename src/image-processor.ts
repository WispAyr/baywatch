import sharp from 'sharp';

export interface Point {
  x: number;
  y: number;
}

export interface Blob {
  id: number;
  area: number;
  centroid: Point;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface AnalysisResult {
  blobs: Blob[];
  count: number;
  mask?: Buffer;
}

/**
 * Convert image to grayscale buffer
 */
export async function toGrayscale(imageBuffer: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(imageBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  return { data, width: info.width, height: info.height };
}

/**
 * Compute absolute difference between two grayscale images
 */
export function computeDifference(
  current: Buffer,
  background: Buffer,
  threshold: number = 30
): Buffer {
  const result = Buffer.alloc(current.length);
  
  for (let i = 0; i < current.length; i++) {
    const diff = Math.abs(current[i] - background[i]);
    result[i] = diff > threshold ? 255 : 0;
  }
  
  return result;
}

/**
 * Apply morphological operations (erosion + dilation) to clean up noise
 */
export function morphologyClean(
  data: Buffer,
  width: number,
  height: number,
  iterations: number = 2
): Buffer {
  let result = Buffer.from(data);
  
  // Erosion - remove small noise
  for (let iter = 0; iter < iterations; iter++) {
    const eroded = Buffer.alloc(result.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        // 3x3 erosion - pixel is white only if all neighbors are white
        let allWhite = true;
        for (let dy = -1; dy <= 1 && allWhite; dy++) {
          for (let dx = -1; dx <= 1 && allWhite; dx++) {
            if (result[(y + dy) * width + (x + dx)] === 0) {
              allWhite = false;
            }
          }
        }
        eroded[idx] = allWhite ? 255 : 0;
      }
    }
    result = eroded;
  }
  
  // Dilation - expand remaining blobs
  for (let iter = 0; iter < iterations; iter++) {
    const dilated = Buffer.alloc(result.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        // 3x3 dilation - pixel is white if any neighbor is white
        let anyWhite = false;
        for (let dy = -1; dy <= 1 && !anyWhite; dy++) {
          for (let dx = -1; dx <= 1 && !anyWhite; dx++) {
            if (result[(y + dy) * width + (x + dx)] === 255) {
              anyWhite = true;
            }
          }
        }
        dilated[idx] = anyWhite ? 255 : 0;
      }
    }
    result = dilated;
  }
  
  return result;
}

/**
 * Create a polygon mask
 */
export function createPolygonMask(
  polygon: Point[],
  width: number,
  height: number
): Buffer {
  const mask = Buffer.alloc(width * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isPointInPolygon({ x, y }, polygon)) {
        mask[y * width + x] = 255;
      }
    }
  }
  
  return mask;
}

/**
 * Check if point is inside polygon (ray casting algorithm)
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Apply mask to binary image
 */
export function applyMask(data: Buffer, mask: Buffer): Buffer {
  const result = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = mask[i] === 255 ? data[i] : 0;
  }
  return result;
}

/**
 * Connected components labeling (flood fill based)
 * Returns labeled regions and blob statistics
 */
export function findBlobs(
  binaryData: Buffer,
  width: number,
  height: number,
  minArea: number = 500,
  maxArea: number = 50000
): Blob[] {
  const labels = new Int32Array(binaryData.length);
  const blobs: Blob[] = [];
  let currentLabel = 0;
  
  // Flood fill function
  const floodFill = (startX: number, startY: number, label: number): { area: number; sumX: number; sumY: number; minX: number; minY: number; maxX: number; maxY: number } => {
    const stack: [number, number][] = [[startX, startY]];
    let area = 0;
    let sumX = 0, sumY = 0;
    let minX = startX, minY = startY, maxX = startX, maxY = startY;
    
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const idx = y * width + x;
      
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (binaryData[idx] === 0 || labels[idx] !== 0) continue;
      
      labels[idx] = label;
      area++;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      
      // 4-connectivity
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    
    return { area, sumX, sumY, minX, minY, maxX, maxY };
  };
  
  // Find all connected components
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binaryData[idx] === 255 && labels[idx] === 0) {
        currentLabel++;
        const stats = floodFill(x, y, currentLabel);
        
        // Filter by area
        if (stats.area >= minArea && stats.area <= maxArea) {
          blobs.push({
            id: currentLabel,
            area: stats.area,
            centroid: {
              x: Math.round(stats.sumX / stats.area),
              y: Math.round(stats.sumY / stats.area)
            },
            boundingBox: {
              x: stats.minX,
              y: stats.minY,
              width: stats.maxX - stats.minX + 1,
              height: stats.maxY - stats.minY + 1
            }
          });
        }
      }
    }
  }
  
  return blobs;
}

/**
 * Analyze frame for motion/objects in zone
 */
export async function analyzeFrame(
  currentFrame: Buffer,
  backgroundFrame: Buffer | null,
  polygon: Point[],
  options: {
    threshold?: number;
    minBlobArea?: number;
    maxBlobArea?: number;
    morphIterations?: number;
  } = {}
): Promise<AnalysisResult> {
  const {
    threshold = 30,
    minBlobArea = 500,
    maxBlobArea = 50000,
    morphIterations = 2
  } = options;
  
  // Convert to grayscale
  const current = await toGrayscale(currentFrame);
  
  // If no background, use static thresholding on grayscale variance
  let diffData: Buffer;
  
  if (backgroundFrame) {
    const background = await toGrayscale(backgroundFrame);
    
    // Ensure same dimensions
    if (current.width !== background.width || current.height !== background.height) {
      throw new Error('Frame dimensions do not match background');
    }
    
    // Compute difference
    diffData = computeDifference(current.data, background.data, threshold);
  } else {
    // No background - use simple thresholding based on local contrast
    // This is a fallback that detects darker objects against lighter background
    diffData = Buffer.alloc(current.data.length);
    const avgBrightness = current.data.reduce((a, b) => a + b, 0) / current.data.length;
    
    for (let i = 0; i < current.data.length; i++) {
      diffData[i] = Math.abs(current.data[i] - avgBrightness) > threshold ? 255 : 0;
    }
  }
  
  // Apply morphological cleanup
  const cleaned = morphologyClean(diffData, current.width, current.height, morphIterations);
  
  // Create and apply polygon mask
  const mask = createPolygonMask(polygon, current.width, current.height);
  const masked = applyMask(cleaned, mask);
  
  // Find blobs
  const blobs = findBlobs(masked, current.width, current.height, minBlobArea, maxBlobArea);
  
  // Create debug mask image
  const maskImage = await sharp(masked, {
    raw: { width: current.width, height: current.height, channels: 1 }
  }).png().toBuffer();
  
  return {
    blobs,
    count: blobs.length,
    mask: maskImage
  };
}

/**
 * Update background using running average
 */
export async function updateBackground(
  currentFrame: Buffer,
  existingBackground: Buffer | null,
  alpha: number = 0.1
): Promise<Buffer> {
  const current = await toGrayscale(currentFrame);
  
  if (!existingBackground) {
    // First frame becomes the background
    return sharp(current.data, {
      raw: { width: current.width, height: current.height, channels: 1 }
    }).png().toBuffer();
  }
  
  const background = await toGrayscale(existingBackground);
  
  // Running average: new_bg = (1 - alpha) * old_bg + alpha * current
  const updated = Buffer.alloc(current.data.length);
  for (let i = 0; i < current.data.length; i++) {
    updated[i] = Math.round((1 - alpha) * background.data[i] + alpha * current.data[i]);
  }
  
  return sharp(updated, {
    raw: { width: current.width, height: current.height, channels: 1 }
  }).png().toBuffer();
}
