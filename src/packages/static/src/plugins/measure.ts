/*
Plugin to produce an HTML map showing the contents of our bundles.

NOTE: We use analyzerMode="static" to get a static file (dist/report.html)
instead of running a webserver, which gets complicated in some environments.
*/

import { BundleAnalyzerPlugin } from "webpack-bundle-analyzer";

export default function measurePlugin(registerPlugin) {
  registerPlugin(
    "BundleAnalyzerPlugin -- visualize size and content of webpack output files",
    new BundleAnalyzerPlugin({
      analyzerMode: "static",
      reportFilename: "measure.html",
    })
  );
}
