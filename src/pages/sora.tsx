import type { NextPage } from "next";
import Head from "next/head";
import SoraVideoGenerator from "@components/Sora/SoraVideoGenerator";

const SoraPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Sora Video Generator</title>
        <meta
          name="description"
          content="Generate AI videos with Sora 2 via Kie AI API"
        />
      </Head>
      <SoraVideoGenerator />
    </>
  );
};

export default SoraPage;
