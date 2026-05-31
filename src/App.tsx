import { Viewer } from './scene/Viewer';
import { DropZone } from './ingest/DropZone';
import { FileInfo } from './ui/FileInfo';
import { ControlPanel } from './ui/ControlPanel';
import { LayerSlider } from './ui/LayerSlider';
import { StatsOverlay } from './ui/StatsOverlay';
import { ColorLegend } from './ui/ColorLegend';
import { AdditiveModels } from './additive/AdditiveModel';
import { SubtractiveModel } from './subtractive/SubtractiveModel';

// Single shared R3F scene hosts BOTH renderers (each self-gates on the active
// mode): the additive view renders models natively as geometry, the subtractive
// view renders the carved stock. Overlays sit on top.
export default function App() {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Viewer>
        <AdditiveModels />
        <SubtractiveModel />
      </Viewer>

      <FileInfo />
      <ControlPanel />
      <LayerSlider />
      <StatsOverlay />
      <ColorLegend />
      <DropZone />
    </div>
  );
}
