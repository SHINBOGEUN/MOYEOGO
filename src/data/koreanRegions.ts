import regionData from './koreanRegions.json';

export type RegionNode = {
  name: string;
  children?: RegionNode[];
};

// Generated from the Ministry of the Interior and Safety's 2026-09-30 administrative-dong codes.
export const KOREAN_REGIONS: RegionNode[] = regionData;
