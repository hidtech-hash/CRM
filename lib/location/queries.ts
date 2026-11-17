import { INDIA_LOCATIONS } from "./indiaLocations";

// The ONE place anything in the CRM reads location data from. Every
// cascading State/District/Taluka selector — customer creation
// (Employee and Agent, same component, same data), customer editing,
// any future address form — calls these three functions and nothing
// else. If the data source ever changes (a fuller dataset, a real
// package, a database table), only indiaLocations.ts needs to
// change; nothing here or in any component does.

export function getStates(): string[] {
  return INDIA_LOCATIONS.map((s) => s.name);
}

export function getDistricts(stateName: string | null | undefined): string[] {
  if (!stateName) return [];
  const state = INDIA_LOCATIONS.find((s) => s.name === stateName);
  return state ? state.districts.map((d) => d.name) : [];
}

export function getTalukas(stateName: string | null | undefined, districtName: string | null | undefined): string[] {
  if (!stateName || !districtName) return [];
  const state = INDIA_LOCATIONS.find((s) => s.name === stateName);
  const district = state?.districts.find((d) => d.name === districtName);
  return district?.talukas ?? [];
}
