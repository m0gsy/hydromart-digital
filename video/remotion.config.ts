import { Config } from '@remotion/cli/config';

// ponytail: the container's preinstalled headless shell; override with REMOTION_BROWSER on other machines.
if (process.env.REMOTION_BROWSER) Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
