type CoordinatePart = number | string | { numerator?: number; denominator?: number };

function scalar(value: CoordinatePart): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object' && typeof value.numerator === 'number' && typeof value.denominator === 'number' && value.denominator !== 0) {
    return value.numerator / value.denominator;
  }
  return null;
}

function degrees(value: unknown): number | null {
  if (Array.isArray(value)) {
    const parts = value.map((part) => scalar(part as CoordinatePart));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => part !== null)) {
      return (parts[0] as number) + (parts[1] as number) / 60 + (parts[2] as number) / 3600;
    }
    return parts.length === 1 ? parts[0] : null;
  }
  if (typeof value === 'string' && value.includes(',')) {
    return degrees(value.split(',').map((part) => part.trim()));
  }
  if (typeof value === 'object' && value !== null) {
    const objectValue = value as Record<string, unknown>;
    if ('degrees' in objectValue && 'minutes' in objectValue && 'seconds' in objectValue) {
      return degrees([objectValue.degrees, objectValue.minutes, objectValue.seconds]);
    }
  }
  return scalar(value as CoordinatePart);
}

function withHemisphere(value: unknown, reference: unknown, maximum: number): number | undefined {
  const parsed = degrees(value);
  if (parsed === null || parsed < 0 || parsed > maximum) return undefined;
  const ref = typeof reference === 'string' ? reference.trim().toUpperCase() : '';
  if (ref && ref !== 'N' && ref !== 'S' && ref !== 'E' && ref !== 'W') return undefined;
  return ref === 'S' || ref === 'W' ? -parsed : parsed;
}

export function coordinatesFromExif(exif: Record<string, unknown> | null | undefined) {
  if (!exif) return undefined;
  const latitude = withHemisphere(exif.GPSLatitude, exif.GPSLatitudeRef, 90);
  const longitude = withHemisphere(exif.GPSLongitude, exif.GPSLongitudeRef, 180);
  if (latitude === undefined || longitude === undefined) return undefined;
  return { latitude, longitude };
}
