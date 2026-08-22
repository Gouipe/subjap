# Japanese frequency data

`opensubtitles-ja-jmdict-top8598.tsv` is a compact derivative of the Japanese
subtitle frequency data from OpenSubtitles 2018. The upstream data is matched
against JMdict vocabulary before being packaged, which removes punctuation,
subtitle noise and raw morphological fragments. Regenerate it with
`npm.cmd run frequency:update`.

Sources:

- <https://github.com/jkindrix/japanese-language-data>
- <https://github.com/hermitdave/FrequencyWords>
- <https://www.opensubtitles.org/>

The frequency data is distributed under CC-BY-SA 4.0. It is derived from
FrequencyWords/OpenSubtitles and matched against JMdict; see the upstream
notices for attribution details.
