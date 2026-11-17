"use client";

import { useMemo } from "react";
import { getStates, getDistricts, getTalukas } from "@/lib/location/queries";

// The ONE cascading location selector for the whole CRM (customer
// create/edit for Employees AND Agents, user profiles, …). Every
// instance reads the same lib/location/queries.ts — one dataset, no
// per-form copies.
//
// Fully controlled: the parent owns state/district/taluka strings.
//   - changing State resets District + Taluka;
//   - changing District resets Taluka;
//   - District / Taluka options are filtered to the parent selection.
//
// Honest handling of incomplete data: where the dataset has no
// districts (or talukas) for the chosen State (or District) yet, that
// level becomes a plain text box so the user can still record the real
// value instead of being blocked. A saved value that isn't in the list
// (older free-text records) is kept as an extra option, never dropped.
function withCurrent(options: string[], current: string) {
  return current && !options.includes(current) ? [current, ...options] : options;
}

export default function LocationSelect({
  state,
  district,
  taluka,
  onChange,
  talukaLabel = "Taluka / Tehsil",
  required = false,
}: {
  state: string;
  district: string;
  taluka: string;
  onChange: (next: { state: string; district: string; taluka: string }) => void;
  talukaLabel?: string;
  required?: boolean;
}) {
  const states = useMemo(() => withCurrent(getStates(), state), [state]);
  const knownDistricts = useMemo(() => getDistricts(state), [state]);
  const knownTalukas = useMemo(() => getTalukas(state, district), [state, district]);
  const districts = useMemo(() => withCurrent(knownDistricts, district), [knownDistricts, district]);
  const talukas = useMemo(() => withCurrent(knownTalukas, taluka), [knownTalukas, taluka]);

  const districtIsText = !!state && knownDistricts.length === 0;
  const talukaIsText = !!district && knownTalukas.length === 0;

  const selectCls =
    "w-full border rounded px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400";
  const inputCls = "w-full border rounded px-2 py-1.5 text-sm";

  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <label className="block text-xs mb-1">
          State {required && <span className="text-red-500">*</span>}
        </label>
        <select
          className={selectCls}
          value={state}
          onChange={(e) => onChange({ state: e.target.value, district: "", taluka: "" })}
        >
          <option value="">Select State...</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs mb-1">District</label>
        {districtIsText ? (
          <input
            className={inputCls}
            placeholder="Type district"
            value={district}
            onChange={(e) => onChange({ state, district: e.target.value, taluka: "" })}
          />
        ) : (
          <select
            className={selectCls}
            value={district}
            onChange={(e) => onChange({ state, district: e.target.value, taluka: "" })}
            disabled={!state}
          >
            <option value="">{!state ? "Select a State first" : "Select District..."}</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="block text-xs mb-1">{talukaLabel}</label>
        {talukaIsText ? (
          <input
            className={inputCls}
            placeholder={`Type ${talukaLabel.toLowerCase()}`}
            value={taluka}
            onChange={(e) => onChange({ state, district, taluka: e.target.value })}
          />
        ) : (
          <select
            className={selectCls}
            value={taluka}
            onChange={(e) => onChange({ state, district, taluka: e.target.value })}
            disabled={!district}
          >
            <option value="">{!district ? "Select a District first" : `Select ${talukaLabel}...`}</option>
            {talukas.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
