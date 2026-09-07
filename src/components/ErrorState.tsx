type Props = {
  message: string;
  previewUrl?: string;
  onReset: () => void;
};

export function ErrorState({ message, previewUrl, onReset }: Props) {
  return (
    <section className="panel error-panel">
      {previewUrl ? (
        <img className="error-thumb" src={previewUrl} alt="Uploaded photo" />
      ) : null}
      <p className="eyebrow danger">Couldn’t place this one</p>
      <h2>Something went sideways</h2>
      <p className="lede">{message}</p>
      <button type="button" className="btn" onClick={onReset}>
        Try another photo
      </button>
    </section>
  );
}
