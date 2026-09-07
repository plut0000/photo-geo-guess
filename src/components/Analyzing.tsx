type Props = {
  previewUrl: string;
  phase: string;
};

export function Analyzing({ previewUrl, phase }: Props) {
  return (
    <section className="panel analyzing">
      <div className="analyzing-photo">
        <img src={previewUrl} alt="Uploaded photo being analyzed" />
        <div className="scanline" />
      </div>
      <div className="analyzing-copy">
        <p className="eyebrow">Working</p>
        <h2>Reading the photograph</h2>
        <p className="phase">{phase}</p>
        <div className="dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}
