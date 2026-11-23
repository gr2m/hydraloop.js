import { caption, type DeviceState } from "@/lib/model";

import { Time } from "./time";

/** Every valve, pump and sensor the API returned, with its raw value */
export function SignalTable({
  state,
  captions,
}: {
  state: DeviceState;
  captions: Record<string, string>;
}) {
  const names = Object.keys(state.io).sort();
  return (
    <details className="disclosure">
      <summary>All {names.length} valve, pump and sensor signals</summary>
      <table>
        <caption className="sr-only">Raw IO values</caption>
        <thead>
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">IO name</th>
            <th scope="col" className="numeric">
              Value
            </th>
            <th scope="col">Since</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => {
            const io = state.io[name];
            return (
              <tr key={name}>
                <td>
                  {caption(captions, name)}
                  {io?.manual && (
                    <>
                      {" "}
                      <span
                        className="tag is-manual"
                        title="Switched manually instead of by the firmware, e.g. by a technician"
                      >
                        Manual
                      </span>
                    </>
                  )}
                </td>
                <td className="mono muted">{name}</td>
                <td className="numeric">
                  {io === undefined ? (
                    "–"
                  ) : (
                    <span className={io.on ? "on-dot" : "off-dot"}>
                      {io.value}
                    </span>
                  )}
                </td>
                <td className="mono muted">
                  {io?.since ? <Time t={io.since} format="datetime" /> : "–"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
