import React from 'react';
import { Audio, Composition, getStaticFiles, Sequence, Series, staticFile } from 'remotion';
import { FPS, frames, KEPALA, type Scene, STAFF, VO_DELAY } from './script';
import { Stage, TitleCard } from './ui';
import { STAFF_SCREENS, STAFF_TITLE } from './StaffDepot';
import { KEPALA_SCREENS, KEPALA_TITLE } from './KepalaDepot';

interface TutorialProps {
  scenes: Scene[];
  screens: Record<string, React.FC>;
  titles: { kicker: string; bullets: string[]; outroBullets: string[] };
  /** Prefix of the voice-over files: public/vo/<vo>-01.mp3 … (made by `npm run vo`). */
  vo: string;
}

const Tutorial: React.FC<TutorialProps> = ({ scenes, screens, titles, vo }) => {
  // A voice-over line is used when its file exists; scenes without one stay silent.
  const files = new Set(getStaticFiles().map((f) => f.name));
  return (
    <Series>
      {scenes.map((s, i) => {
        const Screen = screens[s.id];
        const audio = `vo/${vo}-${String(i + 1).padStart(2, '0')}.mp3`;
        return (
          <Series.Sequence key={s.id} durationInFrames={s.sec * FPS} name={`${i + 1}. ${s.title}`}>
            {s.id === 'intro' || s.id === 'outro' ? (
              <TitleCard
                kicker={s.id === 'intro' ? titles.kicker : 'Selesai!'}
                title={s.title}
                sub={s.caption}
                bullets={s.id === 'intro' ? titles.bullets : titles.outroBullets}
              />
            ) : (
              <Stage step={s.step} title={s.title} caption={s.caption}>
                <Screen />
              </Stage>
            )}
            {files.has(audio) && (
              <Sequence from={VO_DELAY} layout="none">
                <Audio src={staticFile(audio)} />
              </Sequence>
            )}
          </Series.Sequence>
        );
      })}
    </Series>
  );
};

const common = { fps: FPS, width: 1080, height: 1920 } as const;

// Wrappers, not defaultProps: the scene map holds components, which props cannot carry.
const StaffVideo: React.FC = () => <Tutorial scenes={STAFF} screens={STAFF_SCREENS} titles={STAFF_TITLE} vo="staff" />;
const KepalaVideo: React.FC = () => <Tutorial scenes={KEPALA} screens={KEPALA_SCREENS} titles={KEPALA_TITLE} vo="kepala" />;

export const Root: React.FC = () => (
  <>
    <Composition id="StaffDepot" component={StaffVideo} durationInFrames={frames(STAFF)} {...common} />
    <Composition id="KepalaDepot" component={KepalaVideo} durationInFrames={frames(KEPALA)} {...common} />
  </>
);
