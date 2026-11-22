import type { Expense, Member } from './settlement';

export type Trip = {
  id: string;
  name: string;
  destination: string;
  detailAddress: string;
  dateRange: string;
  treasurerId: string;
  expenses: Expense[];
  startedAt?: string;
  endedAt?: string;
  photos?: TripPhoto[];
  coverPhotoId?: string;
  settledAt?: string;
  /** Revision of the normalized shared-trip records last merged on this device. */
  syncRevision?: number;
};

export type TripPhoto = {
  id: string;
  uri: string;
  addedAt: string;
  latitude?: number;
  longitude?: number;
  /** Present only for photos registered in the shared trip sync store. */
  storageKey?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  version?: number;
};

export type Group = {
  id: string;
  name: string;
  members: Member[];
  trips: Trip[];
};
