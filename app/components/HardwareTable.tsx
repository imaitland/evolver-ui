import { Link, useParams } from "@remix-run/react";
import { EvolverConfigWithoutDefaults } from "client";
import clsx from "clsx";

export function HardwareTable({
  evolverConfig,
}: {
  evolverConfig: EvolverConfigWithoutDefaults;
}) {
  const { hardware_name } = useParams();
  const evolverHardware = evolverConfig.hardware;

  const TableRows = Object.keys(evolverHardware).map((key, ix) => {
    const { classinfo, config } = evolverHardware[key];
    const { vials } = config;
    const vialsString = vials.join(", ");
    return (
      <tr key={key} className={clsx(hardware_name === key && "bg-base-300")}>
        <td>{key}</td>
        <td>{classinfo}</td>
        <td>{vialsString}</td>
        <td>
          <Link
            to={`../hardware/${key}/history`}
            className="link tooltip text-primary"
            data-tip="view hardware readings"
          >
            view
          </Link>
        </td>
      </tr>
    );
  });

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Classinfo</th>
          <th>Vials</th>
          <th>History</th>
        </tr>
      </thead>
      <tbody>{TableRows}</tbody>
    </table>
  );
}
