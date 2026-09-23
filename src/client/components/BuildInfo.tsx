const buildTime = new Date(__BUILD_TIME__).toLocaleString('ru-RU');

export function BuildInfo({ extra }: { extra?: string }) {
  return (
    <div className="build-info">
      build {buildTime}
      {extra ? ` · ${extra}` : ''}
    </div>
  );
}
