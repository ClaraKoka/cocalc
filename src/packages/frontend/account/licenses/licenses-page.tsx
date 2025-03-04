/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { A } from "@cocalc/frontend/components";
import { Footer } from "@cocalc/frontend/customize";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { BuyLicenseForProject } from "@cocalc/frontend/site-licenses/purchase/buy-license-for-project";
import { join } from "path";
import { AboutLicenses } from "./about-licenses";
import { ManagedLicenses } from "./managed-licenses";
import { ProjectsWithLicenses } from "./projects-with-licenses";

export const LicensesPage: React.FC = () => {
  return (
    <div>
      <h3>
        <A href={join(appBasePath, "licenses")}>
          Visit the License Management Center...
        </A>
      </h3>
      <div>
        <BuyLicenseForProject />
      </div>
      <br />
      <AboutLicenses />
      <br />
      <ManagedLicenses />
      <br />
      <ProjectsWithLicenses />
      <br />
      <Footer />
    </div>
  );
};
