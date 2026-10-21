<script lang="ts">
  import Card from '#lib/components/Card.svelte';
</script>

<section class="hero">
  <div class="hero-copy">
    <div class="eyebrow">
      <span class="little-line"></span>
      Hecho para cantar truco
    </div>
    <h1>
      El truco de aquí.
      <br />
      <em>Donde estés.</em>
    </h1>
    <p>
      Reúne a los tuyos, reparte las cartas y deja que hablen las señas. El truco venezolano ya
      tiene mesa.
    </p>
    <div class="row hero-notes">
      <span>Sin descargas</span>
      <span>Sin cuenta obligatoria</span>
      <span>Con toda la picardía</span>
    </div>
  </div>
  <div class="hero-art" aria-hidden="true">
    <div class="halo"></div>
    <div class="fan fan-left"><Card card={{ suit: 'coins', number: 7 }} width={143} /></div>
    <div class="fan fan-right"><Card card={{ suit: 'clubs', number: 1 }} width={143} /></div>
    <div class="fan fan-center"><Card card={{ suit: 'spades', number: 1 }} width={143} /></div>
    <span class="hero-stamp">
      40 CARTAS
      <br />
      <strong>mil historias.</strong>
    </span>
    <span class="spark spark-one">✦</span>
    <span class="spark spark-two">✦</span>
  </div>
</section>

<style>
  .hero {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 3rem;
    align-items: center;
    padding: 58px 0 46px;
  }
  .hero-copy > .eyebrow {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: #8e563c;
  }
  .little-line {
    height: 1px;
    width: 28px;
    background: #a65e3d;
  }
  h1 {
    font-size: clamp(2.8rem, 4.6vw, 4.3rem);
    line-height: 1.07;
    letter-spacing: -0.05em;
    margin: 20px 0;
  }
  h1 em {
    font-weight: 400;
    color: #9d4f32;
  }
  .hero-copy > p {
    max-width: 440px;
    line-height: 1.75;
    color: #626c5e;
    font-size: 1rem;
  }
  .hero-notes {
    gap: 1.25rem;
    font-size: 0.68rem;
    margin-top: 22px;
    color: #6a7465;
  }
  .hero-notes span::before {
    content: '•';
    color: #9f5635;
    margin-right: 0.4rem;
  }
  .hero-art {
    height: 290px;
    position: relative;
    display: grid;
    place-items: center;
  }
  .halo {
    position: absolute;
    width: 290px;
    height: 290px;
    border: 1px solid #d3d5c1;
    border-radius: 50%;
    background: radial-gradient(circle, #e4e6d1 0%, transparent 70%);
  }
  .fan {
    position: absolute;
    top: 27px;
    left: calc(50% - 72px);
    filter: drop-shadow(0 14px 12px #153a2425);
  }
  .fan-left {
    transform: translateX(-70px) rotate(-21deg);
  }
  .fan-right {
    transform: translateX(70px) rotate(20deg);
  }
  .fan-center {
    transform: rotate(-3deg) translateY(-12px);
  }
  .hero-stamp {
    position: absolute;
    right: 5%;
    bottom: 3%;
    border-radius: 50%;
    border: 1px solid #a55a36;
    color: #a55a36;
    width: 105px;
    height: 105px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    transform: rotate(10deg);
    background: #f4efe3d9;
  }
  .hero-stamp strong {
    font:
      italic 1rem 'Nunito Variable',
      sans-serif;
    letter-spacing: 0;
  }
  .spark {
    position: absolute;
    color: #a55a36;
    font-size: 1.6rem;
  }
  .spark-one {
    left: 10%;
    top: 10%;
  }
  .spark-two {
    right: 6%;
    top: 18%;
    font-size: 1rem;
  }
  @media (max-width: 1000px) {
    .hero {
      gap: 15px;
    }
    .hero-stamp {
      right: 0;
    }
  }
  @media (max-width: 760px) {
    .hero {
      grid-template-columns: 1fr;
      padding: 35px 0 28px;
      gap: 0;
    }
    .hero-art {
      height: 250px;
      margin-top: 25px;
    }
    .hero-copy > p {
      max-width: 100%;
    }
    .hero-copy {
      text-align: center;
    }
    .hero-copy > .eyebrow,
    .hero-notes {
      justify-content: center;
    }
    h1 {
      font-size: 3.2rem;
    }
    .hero-art .halo {
      width: 240px;
      height: 240px;
    }
    .hero-art .fan {
      top: 15px;
    }
    .hero-art .fan :global(img) {
      width: 120px;
      height: auto;
    }
    .hero-stamp {
      right: 12%;
      bottom: 0;
    }
  }
</style>
