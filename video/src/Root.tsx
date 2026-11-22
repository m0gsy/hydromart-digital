import { AbsoluteFill, Composition } from 'remotion';
const T = () => <AbsoluteFill style={{ background: '#0b4d57', color: 'white', fontSize: 80 }}>tes</AbsoluteFill>;
export const Root = () => <Composition id="Tes" component={T} durationInFrames={30} fps={30} width={1080} height={1920} />;
