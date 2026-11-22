/** Tracks which command may publish the visible status for each trip. */
export class TripSyncStatusGeneration {
  private readonly generations = new Map<string, number>();

  begin(tripKey: string): number {
    const generation = (this.generations.get(tripKey) ?? 0) + 1;
    this.generations.set(tripKey, generation);
    return generation;
  }

  isCurrent(tripKey: string, generation: number): boolean {
    return this.generations.get(tripKey) === generation;
  }
}
