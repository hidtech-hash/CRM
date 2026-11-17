// Shared shape for the location data layer, kept deliberately small
// so the DATA SOURCE behind it can change later (a bigger embedded
// dataset, a real npm package, a database table, an external API)
// without touching any component that consumes it — every caller
// only ever talks to the functions in queries.ts, never this file's
// raw data directly.

export type StateName = string;
export type DistrictName = string;
export type TalukaName = string;

// One record per state: its districts, and each district's talukas.
// Talukas are optional per district — a district can be present with
// an empty/undefined taluka list if that level of detail hasn't been
// filled in yet; the UI (LocationSelect) treats "no talukas known for
// this district" as a normal empty state, not an error.
export interface StateData {
  name: StateName;
  districts: {
    name: DistrictName;
    talukas?: TalukaName[];
  }[];
}
