import '../styles/globals.css';
import type {AppProps} from 'next/app';
import Head from 'next/head';
import {createTheme, NextUIProvider} from '@nextui-org/react';
import {ThemeProvider as NextThemesProvider} from 'next-themes';
import {Layout} from '../components/layout/layout';
import {SessionProvider} from 'next-auth/react';

const dashboardTheme = createTheme({
  type: 'dark',
  theme: {
    colors: {
      text: '#ffffff',
      foreground: '#ffffff',
      background: '#020617',
      backgroundContrast: '#05070d',
      border: 'rgba(255,255,255,0.22)',
      accents7: 'rgba(255,255,255,0.92)',
      accents8: '#ffffff',
    },
  },
});

function MyApp({Component, pageProps}: AppProps) {
  return (
    <SessionProvider session={(pageProps as any).session}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <NextThemesProvider
        defaultTheme="system"
        attribute="class"
        value={{
          light: dashboardTheme.className,
          dark: dashboardTheme.className,
        }}
      >
        <NextUIProvider>
          <Layout>
            <Component {...pageProps} />
          </Layout>
        </NextUIProvider>
      </NextThemesProvider>
    </SessionProvider>
  );
}

export default MyApp;
